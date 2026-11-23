//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { AccountRole } from '@hcengineering/core'
import { getClient, isWorkspaceLoginInfo } from '@hcengineering/account-client'
import type { Config } from './config'
import { ConnectionStore, validIds } from './integrations'
import { TokenEncryption } from './security'
import { SendError, getPhoneStatus, listTemplates } from './graph'
import { WahaClient, parseWahaEvent, sessionName, verifyWahaSignature } from './waha'
import { parseWebhook, verifySignature, verifyChallenge, type WebhookBatch } from './webhook'

export function createApp (
  config: Config,
  store: ConnectionStore,
  inbox?: { enqueue: (batch: WebhookBatch) => Promise<void> },
  request: typeof fetch = fetch,
  notifyDisconnected?: (integration: Awaited<ReturnType<ConnectionStore['findWaha']>>) => Promise<void>
): express.Express {
  const app = express()
  // Auraplex: provider selection is server-wide; no connection can override it.
  const waha = config.provider === 'waha' ? new WahaClient(config, request) : undefined
  const encryption = new TokenEncryption()
  app.disable('x-powered-by')
  app.use(
    cors({
      origin: config.allowedOrigins,
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type']
    })
  )
  // The raw bytes belong to this request, not shared state between requests.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, bytes) => {
        ;(req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(bytes)
      }
    })
  )
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.get('/webhook', (req, res) => {
    if (
      waha !== undefined || !verifyChallenge(req.query['hub.mode'], req.query['hub.verify_token'], config.verifyToken ?? '') ||
      typeof req.query['hub.challenge'] !== 'string'
    ) {
      res.sendStatus(403)
      return
    }
    res.type('text/plain').send(req.query['hub.challenge'])
  })
  app.post('/webhook', (req, res) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody
    if (waha !== undefined || raw === undefined || !verifySignature(raw, req.get('X-Hub-Signature-256'), config.appSecret ?? '')) {
      res.sendStatus(401)
      return
    }
    let batch: WebhookBatch
    try {
      batch = parseWebhook(req.body)
    } catch {
      res.status(400).json({ code: 'InvalidWebhook' })
      return
    }
    if (inbox === undefined) {
      res.sendStatus(503)
      return
    }
    void inbox
      .enqueue(batch)
      .then(() => {
        res.sendStatus(200)
      })
      .catch(() => {
        res.sendStatus(503)
      })
  })

  async function refreshWaha (session: string): Promise<{ status: string, phone?: string }> {
    const current = await store.findWaha(session)
    if (current?.data?.wahaStatus === 'CONFLICT') {
      await waha?.disconnect(session)
      return { status: 'CONFLICT' }
    }
    const remote = await waha?.status(session)
    const status = remote?.status ?? 'STOPPED'
    const me = status === 'WORKING' ? remote?.me ?? await waha?.me(session) : undefined
    const phone = status === 'WORKING' ? me?.id?.match(/^(\d+)@(?:c\.us|s\.whatsapp\.net)$/)?.[1] : undefined
    try {
      if (status === 'WORKING' && phone === undefined) return { status: 'STARTING' }
      if (current?.data?.wahaStatus === 'WORKING' && ['FAILED', 'STOPPED', 'SCAN_QR_CODE'].includes(status)) {
        await notifyDisconnected?.(current)
      }
      await store.updateWaha(session, status, phone)
      return { status, phone }
    } catch (err) {
      if (!(err instanceof Error) || err.message !== 'Conflict') throw err
      await waha?.disconnect(session)
      return { status: 'CONFLICT' }
    }
  }

  const wahaRequests = new Map<string, number>()
  app.post('/webhook/waha', (req, res) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody
    if (waha === undefined || raw === undefined ||
      !verifyWahaSignature(raw, req.get('X-Webhook-Hmac') ?? '', config.wahaWebhookSecret ?? '')) {
      res.sendStatus(401)
      return
    }
    void (async () => {
      const body = req.body
      const now = Date.now()
      const fresh = (value: unknown): boolean => Number.isFinite(Number(value)) && Math.abs(now - Number(value)) <= 300_000
      const requestId = req.get('X-Webhook-Request-Id')
      if (!fresh(req.get('X-Webhook-Timestamp')) || !fresh(body?.timestamp) || !requestId ||
        req.get('X-Webhook-Hmac-Algorithm')?.toLowerCase() !== 'sha512') {
        res.sendStatus(401)
        return
      }
      const unique = JSON.stringify([body?.session, body?.id ?? requestId, req.get('X-Webhook-Hmac')])
      if ((wahaRequests.get(unique) ?? 0) > now) { res.sendStatus(200); return }
      const accepted = (): void => {
        if (wahaRequests.size >= 10_000) {
          for (const [id, expiry] of wahaRequests) if (expiry <= now) wahaRequests.delete(id)
          if (wahaRequests.size >= 10_000) wahaRequests.clear()
        }
        wahaRequests.set(unique, now + 300_000)
        res.sendStatus(200)
      }
      if (typeof body?.session !== 'string' || !/^huly-[a-f0-9]{32}$/.test(body.session) ||
        typeof body.event !== 'string' || body.payload == null || typeof body.payload !== 'object') {
        res.sendStatus(200)
        return
      }
      const integration = await store.findWaha(body.session)
      if (integration?.workspaceUuid == null || sessionName(integration.workspaceUuid, integration.socialId) !== body.session) {
        res.sendStatus(200)
        return
      }
      if (body.event === 'session.status') {
        await refreshWaha(body.session)
        accepted()
        return
      }
      const phone = integration.data?.wahaPhone
      if (integration.data?.wahaStatus !== 'WORKING' || typeof phone !== 'string') { res.sendStatus(200); return }
      const peer = body.payload.chatId ?? (body.payload.fromMe === true ? body.payload.to ?? body.payload.from : body.payload.from)
      const mapped = typeof peer === 'string' && peer.endsWith('@lid') ? await waha.resolveLid(body.session, peer) : undefined
      const batch = parseWahaEvent(body.event, body.session, phone, { ...body.payload, ...(mapped === undefined ? {} : { chatId: mapped }) })
      if (batch.messages.length + batch.statuses.length > 0) {
        if (inbox === undefined) { res.sendStatus(503); return }
        await inbox.enqueue(batch)
      }
      accepted()
    })().catch(() => res.sendStatus(503))
  })

  app.use('/api', (req, res, next) => {
    void (async () => {
      const bearer = req.headers.authorization
      if (bearer === undefined || !bearer.startsWith('Bearer ')) {
        res.sendStatus(401)
        return
      }
      const account = getClient(config.accountsUrl, bearer.slice(7))
      let login
      try {
        login = await account.getLoginInfoByToken()
      } catch {
        res.sendStatus(401)
        return
      }
      if (!isWorkspaceLoginInfo(login)) {
        res.sendStatus(401)
        return
      }
      // Members who reply may read the (secret-free) connection and the template list.
      if (![AccountRole.User, AccountRole.Owner, AccountRole.Admin, AccountRole.Maintainer].includes(login.role)) {
        res.status(403).json({ code: 'Forbidden' })
        return
      }
      const socialIds = await account.getSocialIds()
      const social = socialIds.find((id) => (id.verifiedOn ?? 0) > 0 && id.isDeleted !== true)
      if (social === undefined) {
        res.sendStatus(403)
        return
      }
      res.locals.role = login.role
      res.locals.workspace = login.workspace
      res.locals.socialId = social._id
      res.locals.owner = login.workspace + ':' + login.account
      next()
    })().catch(() => {
      res.status(503).json({ code: 'Unavailable' })
    })
  })

  const wahaState = async (res: Response, withQr = false): Promise<unknown> => {
    const integration = await store.get(res.locals.workspace, res.locals.socialId)
    const session = integration?.data?.wahaSession
    if (!config.wahaUrl || !config.wahaApiKey || !config.wahaWebhookSecret) {
      return { provider: 'waha', connected: false, status: 'UNCONFIGURED' }
    }
    if (waha === undefined || typeof session !== 'string' || session !== sessionName(res.locals.workspace, res.locals.socialId)) {
      return { provider: 'waha', connected: false }
    }
    const { status, phone } = await refreshWaha(session)
    return {
      provider: 'waha', connected: status === 'WORKING' && !!phone,
      status, phoneNumberId: phone, displayPhone: phone === undefined ? undefined : '•••• ' + phone.slice(-4),
      qr: withQr && status === 'SCAN_QR_CODE' ? await waha.qr(session) : undefined
    }
  }

  app.get('/api/qr', (_req, res) => {
    if (waha === undefined) { res.sendStatus(404); return }
    // Only the authenticated user's integration can be loaded. The API accepts no session selector.
    void wahaState(res, true).then((state) => res.json(state)).catch(() => res.status(503).json({ code: 'Unavailable' }))
  })
  app.get('/api/key', (_req, res) => {
    res.json(encryption.createChallenge(res.locals.owner))
  })
  app.get('/api/connection', (_req, res) => {
    if (waha !== undefined) {
      void wahaState(res).then((state) => res.json(state)).catch(() => res.status(503).json({ code: 'Unavailable' }))
      return
    }
    void store
      .get(res.locals.workspace, res.locals.socialId)
      .then((integration) => {
        // Return a whitelist of non-secret fields only.
        res.json({
          connected: integration?.data?.phoneNumberId !== undefined,
          provider: 'meta',
          phoneNumberId: integration?.data?.phoneNumberId,
          wabaId: integration?.data?.wabaId,
          webhook: config.publicUrl + '/webhook',
          mode: config.graphVersion === 'mock' ? 'mock' : 'configured',
          replyWindowMs: config.replyWindowMs
        })
      })
      .catch(() => {
        res.status(503).json({ code: 'Unavailable' })
      })
  })
  app.get('/api/connections', (_req, res) => {
    if (res.locals.role !== AccountRole.Owner) {
      res.status(403).json({ code: 'Forbidden' })
      return
    }
    void store
      .list()
      .then(async (entries) => {
        const summaries = await Promise.all(
          entries
            .filter((entry) => entry.workspaceUuid === res.locals.workspace &&
              (waha === undefined ? entry.data?.phoneNumberId !== undefined : entry.data?.wahaSession !== undefined))
            .map(async (entry) => waha !== undefined ? {
              person: entry.socialId,
              provider: 'waha',
              displayPhone: entry.data?.wahaDisplayPhone,
              connectedOn: entry.data?.wahaConnectedOn,
              status: entry.data?.wahaStatus
            } : ({
              person: entry.socialId,
              phoneNumberId: entry.data?.phoneNumberId,
              connectedOn: entry.data?.connectedOn,
              displayPhone: entry.data?.displayPhone,
              ...(await getPhoneStatus(config, await store.accessToken(entry), entry.data?.phoneNumberId, request))
            }))
        )
        res.json(summaries)
      })
      .catch(() => {
        res.status(503).json({ code: 'Unavailable' })
      })
  })
  app.get('/api/templates', (_req, res) => {
    if (waha !== undefined) { res.json({ templates: [] }); return }
    void (async () => {
      const integration = await store.get(res.locals.workspace, res.locals.socialId)
      const wabaId = integration?.data?.wabaId
      if (integration === undefined || typeof wabaId !== 'string' || !/^\d+$/.test(wabaId)) {
        res.status(409).json({ code: 'NotConnected' })
        return
      }
      const token = await store.accessToken(integration)
      if (token === undefined || token === '') {
        res.status(409).json({ code: 'NotConnected' })
        return
      }
      try {
        res.json({ templates: await listTemplates(config, token, wabaId, request) })
      } catch (err) {
        // Only our own fixed Chinese text goes back; never the provider's message.
        const failure = err instanceof SendError ? err : undefined
        res.status(502).json({ code: 'TemplatesFailed', errorCode: failure?.code, message: failure?.message })
      }
    })().catch(() => {
      res.status(503).json({ code: 'Unavailable' })
    })
  })
  app.post('/api/connection', (req, res) => {
    void (async () => {
      if (waha !== undefined) {
        if (!config.wahaUrl || !config.wahaApiKey || !config.wahaWebhookSecret) {
          res.status(503).json({ code: 'Unavailable' })
          return
        }
        const session = sessionName(res.locals.workspace, res.locals.socialId)
        try {
          await waha.start(session)
          await store.startWaha(res.locals.workspace, res.locals.socialId, session)
          res.json(await wahaState(res))
        } catch (err) {
          const single = err instanceof Error && err.message === 'SingleSession'
          res.status(single ? 409 : 503).json({ code: single ? 'SingleSession' : 'Unavailable' })
        }
        return
      }
      if (!validIds(req.body)) {
        res.status(400).json({ code: 'InvalidParameters' })
        return
      }
      let token: string | undefined
      if (req.body.encryptedToken !== undefined) {
        try {
          token = encryption.decrypt(res.locals.owner, req.body.encryptedToken)
        } catch {
          res.status(400).json({ code: 'InvalidParameters' })
          return
        }
      }
      try {
        const integration = await store.connect(
          res.locals.workspace,
          res.locals.socialId,
          { phoneNumberId: req.body.phoneNumberId, wabaId: req.body.wabaId },
          token,
          (await getPhoneStatus(config, token, req.body.phoneNumberId, request)).displayPhone
        )
        res.json({ connected: true, phoneNumberId: integration.data?.phoneNumberId, wabaId: integration.data?.wabaId })
      } catch (err) {
        const message = err instanceof Error ? err.message : ''
        const code = message === 'CONFLICT' ? 'Conflict' : message === 'TOKEN_REQUIRED' ? 'InvalidParameters' : 'Failed'
        res.status(code === 'Conflict' ? 409 : code === 'InvalidParameters' ? 400 : 503).json({ code })
      }
    })().catch(() => {
      res.status(503).json({ code: 'Failed' })
    })
  })
  app.delete('/api/connection', (_req, res) => {
    if (waha !== undefined) {
      void (async () => {
        const connection = await store.get(res.locals.workspace, res.locals.socialId)
        const session = connection?.data?.wahaSession
        if (session === sessionName(res.locals.workspace, res.locals.socialId)) await waha.disconnect(session)
        await store.disconnectWaha(res.locals.workspace, res.locals.socialId)
        res.json({ connected: false })
      })().catch(() => res.status(503).json({ code: 'Failed' }))
      return
    }
    void store
      .disconnect(res.locals.workspace, res.locals.socialId)
      .then(() => {
        res.json({ connected: false })
      })
      .catch(() => {
        res.status(503).json({ code: 'Failed' })
      })
  })
  app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Parser and crypto errors must never echo request bodies or credentials.
    res.status(400).json({ code: 'InvalidParameters' })
  })
  return app
}
