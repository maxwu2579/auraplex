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
import { AccountRole, type WorkspaceUuid, type AccountUuid, type OperationDomain, type Ref } from '@hcengineering/core'
import { getClient, isWorkspaceLoginInfo } from '@hcengineering/account-client'
import { createClient, getTransactorEndpoint } from '@hcengineering/server-client'
import type { Channel } from '@hcengineering/contact'
import type { WorkspaceReceiver } from './workspaceClient'
import type { Config } from './config'
import { ConnectionStore, validIds } from './integrations'
import { TokenEncryption } from './security'
import { MetaProvider, SendError, listTemplates } from './graph'
import { publicSettings, runtimeConfig } from './serviceSettings'
import { WahaMedia, WahaMediaTooLarge } from './wahaMedia'
import { WahaClient, parseWahaEvent, sessionName, verifyWahaSignature } from './waha'
import { parseWebhook, verifySignature, verifyChallenge, type WebhookBatch } from './webhook'

export function createApp (
  config: Config,
  store: ConnectionStore,
  inbox?: { enqueue: (batch: WebhookBatch) => Promise<void> },
  request: typeof fetch = fetch,
  notifyDisconnected?: (integration: Awaited<ReturnType<ConnectionStore['findWaha']>>) => Promise<void>,
  receiver?: Pick<WorkspaceReceiver, 'auditAccess' | 'supervisionEmployees' | 'supervisionMessages' | 'ownsIntegration' | 'attachmentRecipient' | 'mediaPhone' | 'getClient' | 'receive'>,
  onWorking?: () => void
): express.Express {
  const app = express()
  // Auraplex: provider selection is server-wide; no connection can override it.
  const waha = config.provider === 'waha' ? new WahaClient(config, request) : undefined
  const workspaceConfig = async (workspace: string): Promise<Config> =>
    runtimeConfig(config, await store.serviceSettings(workspace as Parameters<ConnectionStore['serviceSettings']>[0]))
  const meta = new MetaProvider(config, store, request)
  const media = new WahaMedia(config, request)
  const encryption = new TokenEncryption()
  app.disable('x-powered-by')
  app.use(
    cors({
      origin: config.allowedOrigins,
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-WA-Channel', 'X-WA-Name', 'X-WA-Mime', 'X-WA-Caption'],
      exposedHeaders: ['X-WA-Name', 'X-WA-Mime']
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

  async function refreshWaha (session: string, waha: WahaClient): Promise<{ status: string, phone?: string }> {
    const current = await store.findWaha(session)
    if (current?.data?.wahaStatus === 'CONFLICT') {
      await waha?.disconnect(session)
      return { status: 'CONFLICT' }
    }
    const remote = await waha?.status(session)
    const status = remote?.status ?? 'STOPPED'
    const me = status === 'WORKING' ? remote?.me ?? await waha?.me(session) : undefined
    const jid = me?.id?.endsWith('@lid') === true ? await waha?.resolveLid(session, me.id) : me?.id
    const phone = jid?.match(/^(\d+)@(?:c\.us|s\.whatsapp\.net)$/)?.[1]
    try {
      if (status === 'WORKING' && phone === undefined) return { status: 'STARTING' }
      if (current?.data?.wahaStatus === 'WORKING' && ['FAILED', 'STOPPED', 'SCAN_QR_CODE'].includes(status)) {
        await notifyDisconnected?.(current)
      }
      const updated = await store.updateWaha(session, status, phone)
      if (status === 'WORKING' && current?.data?.wahaStatus !== 'WORKING' && updated?.workspaceUuid != null) {
        const settings = await workspaceConfig(updated.workspaceUuid)
        await store.wahaRequest(updated, settings, request, async () => {}).catch(() => {})
        onWorking?.()
      }
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
    if (waha === undefined || raw === undefined || !/^[a-f0-9]{128}$/i.test(req.get('X-Webhook-Hmac') ?? '')) {
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
        res.sendStatus(401)
        return
      }
      const integration = await store.findWaha(body.session)
      if (integration?.workspaceUuid == null || sessionName(integration.workspaceUuid, integration.socialId) !== body.session) {
        res.sendStatus(401)
        return
      }
      const settings = await workspaceConfig(integration.workspaceUuid)
      if (!verifyWahaSignature(raw, req.get('X-Webhook-Hmac') ?? '', settings.wahaWebhookSecret ?? '')) {
        res.sendStatus(401)
        return
      }
      const waha = new WahaClient(settings, request)
      if (body.event === 'session.status') {
        await refreshWaha(body.session, waha)
        accepted()
        return
      }
      const phone = integration.data?.wahaPhone
      if (integration.data?.wahaStatus !== 'WORKING' || typeof phone !== 'string') { res.sendStatus(200); return }
      const peer = body.payload.chatId ?? (body.payload.fromMe === true ? body.payload.to ?? body.payload.from : body.payload.from)
      const mapped = typeof peer === 'string' && peer.endsWith('@lid')
        ? await store.wahaRequest(integration, settings, request,
          async (scoped) => await new WahaClient(scoped, request).resolveLid(body.session, peer)).catch(() => undefined)
        : undefined
      const batch = parseWahaEvent(body.event, body.session, phone, { ...body.payload, ...(mapped === undefined ? {} : { chatId: mapped }) })
      if (batch.messages.length + batch.statuses.length > 0) {
        if (inbox === undefined) { res.sendStatus(503); return }
        for (const message of batch.messages) {
          if (body.payload.hasMedia === true) message.mediaAvailable = await store.wahaRequest(integration, settings, request,
            async (scoped) => await new WahaMedia(scoped, request).save(body.session, message.wamid, body.payload.media)).catch((err) => {
              if (err instanceof WahaMediaTooLarge) {
                const name = body.payload.media?.filename
                message.content = '[文件太大，未下载]' + (typeof name === 'string' ? ' ' + name.slice(0, 160) : '')
              }
              return false
            })
        }
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
      res.locals.token = bearer.slice(7)
      res.locals.actor = login.account
      res.locals.account = account
      res.locals.role = login.role
      res.locals.workspace = login.workspace
      res.locals.socialId = social._id
      res.locals.owner = login.workspace + ':' + login.account
      next()
    })().catch(() => {
      res.status(503).json({ code: 'Unavailable' })
    })
  })

  // Auraplex: account-service secrets are never read using the browser's credentials.
  app.get('/api/service-settings', (_req, res) => {
    if (res.locals.role !== AccountRole.Owner) { res.sendStatus(403); return }
    void Promise.all([
      store.serviceSettings(res.locals.workspace),
      store.serviceSettings(res.locals.workspace, 'recognizer-settings'),
      store.serviceSettings(res.locals.workspace, 'mail-settings'),
      res.locals.account.getWorkspaceMembers()
    ]).then(([settings, ai, mail, members]) => res.json({ ...publicSettings({ ...settings, ...ai, ...mail }), members }))
      .catch(() => res.sendStatus(503))
  })

  app.post('/api/service-settings', (req, res) => {
    if (res.locals.role !== AccountRole.Owner) { res.sendStatus(403); return }
    void (async () => {
      if (typeof req.body?.wahaUrl === 'string') {
        const origins = (process.env.WHATSAPP_WAHA_ALLOWED_ORIGINS ?? config.wahaUrl ?? '').split(',').filter(Boolean)
        if (!origins.some((origin) => new URL(origin).origin === new URL(req.body.wahaUrl).origin)) {
          res.status(400).json({ code: 'InvalidParameters' })
          return
        }
      }
      if (typeof req.body?.aiUrl === 'string') {
        const allowed = (process.env.PROSPECTS_AI_ALLOWED_ORIGINS ?? process.env.PROSPECTS_AI_URL ?? '').split(',').filter(Boolean)
        const url = new URL(req.body.aiUrl)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
          !allowed.some((origin) => new URL(origin).origin === url.origin)) { res.sendStatus(400); return }
      }
      for (const name of ['mailSmtpHost', 'mailImapHost'] as const) {
        const host = req.body?.[name]
        const allowed = name === 'mailSmtpHost'
          ? (process.env.MAIL_ALLOWED_SMTP_HOSTS ?? process.env.MAIL_SMTP_HOST ?? 'smtp.gmail.com')
          : (process.env.MAIL_ALLOWED_IMAP_HOSTS ?? process.env.MAIL_IMAP_HOST ?? 'imap.gmail.com')
        if (typeof host === 'string' && !allowed.split(',').map((item) => item.trim()).includes(host)) {
          res.sendStatus(400); return
        }
      }
      const sections = new Set(Object.keys(req.body ?? {}).map((name) => name.startsWith('ai') ? 'recognizer-settings' :
        name.startsWith('mail') ? 'mail-settings' : 'settings'))
      if (sections.size !== 1) { res.sendStatus(400); return }
      const members = await res.locals.account.getWorkspaceMembers() as Array<{ person: string }>
      if (sections.has('settings') && (req.body.wahaUrl || req.body.wahaApiKey) && !config.wahaWebhookSecret &&
        !(await store.serviceSettings(res.locals.workspace)).webhookSecret) req.body.regenerateWebhook = true
      const result = await store.saveServiceSettings(res.locals.workspace, req.body, new Set(members.map((item) => item.person)), [...sections][0])
      await receiver?.auditAccess(res.locals.workspace, res.locals.actor, 'WAHA settings: ' + result.fields.join(', '))
      const [waha, ai, mail] = await Promise.all(['settings', 'recognizer-settings', 'mail-settings'].map((name) => store.serviceSettings(res.locals.workspace, name)))
      let warning = false
      if (sections.has('settings') && result.fields.some((key) => ['wahaUrl', 'wahaApiKey', 'regenerateWebhook'].includes(key))) {
        const active = runtimeConfig(config, waha)
        const admin = new WahaClient(active, request)
        warning = !await admin.checkConnection()
        if (!warning && result.fields.includes('regenerateWebhook')) {
          for (const entry of await store.list()) {
            if (entry.workspaceUuid !== res.locals.workspace ||
              entry.data?.wahaSession !== sessionName(res.locals.workspace, entry.socialId)) continue
            try {
              await admin.refreshWebhook(entry.data.wahaSession)
            } catch {
              warning = true
            }
          }
        }
      }
      res.json({ ...publicSettings({ ...waha, ...ai, ...mail }), warning })
    })().catch(() => res.status(400).json({ code: 'InvalidParameters' }))
  })

  const supervisorAllowed = async (res: Response): Promise<boolean> => {
    const settings = await store.serviceSettings(res.locals.workspace)
    return settings.supervisors?.includes(res.locals.actor) === true
  }

  app.get('/api/supervision', (_req, res) => {
    void supervisorAllowed(res).then((allowed) => res.json({ allowed })).catch(() => res.sendStatus(503))
  })

  app.get('/api/supervision/employees', (_req, res) => {
    void (async () => {
      if (!await supervisorAllowed(res)) { res.sendStatus(403); return }
      if (receiver === undefined) { res.sendStatus(503); return }
      res.json(await receiver.supervisionEmployees(res.locals.workspace))
    })().catch(() => res.sendStatus(503))
  })

  app.get('/api/supervision/messages', (req, res) => {
    void (async () => {
      if (!await supervisorAllowed(res)) { res.sendStatus(403); return }
      if (receiver === undefined) { res.sendStatus(503); return }
      const { employee, channel, after, before } = req.query
      if (typeof employee !== 'string' || typeof channel !== 'string' && channel !== undefined) {
        res.sendStatus(400)
        return
      }
      const timestamp = (value: unknown): number | undefined =>
        typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : undefined
      const workspace = res.locals.workspace as WorkspaceUuid
      const rows = await receiver.supervisionMessages(workspace, employee as AccountUuid, channel as Ref<Channel> | undefined,
        timestamp(after), timestamp(before))
      if (channel !== undefined) {
        await receiver.auditAccess(workspace, res.locals.actor, 'WhatsApp supervision · employee ' + employee, channel)
        res.json(rows)
        return
      }
      // List mode returns only conversation summaries and does not expose any unaudited message body.
      const summaries = new Map<string, { channel: string, phone: string, name: string, sendOn: number }>()
      for (const { channel, phone, name, sendOn } of rows) summaries.set(channel, { channel, phone, name, sendOn })
      res.json([...summaries.values()].reverse())
    })().catch(() => res.sendStatus(503))
  })

  const wahaState = async (res: Response, withQr = false): Promise<unknown> => {
    const integration = await store.get(res.locals.workspace, res.locals.socialId)
    const session = integration?.data?.wahaSession
    const settings = await workspaceConfig(res.locals.workspace)
    if (!settings.wahaUrl || !settings.wahaApiKey || !settings.wahaWebhookSecret) {
      return { provider: 'waha', connected: false, status: 'UNCONFIGURED' }
    }
    if (typeof session !== 'string' || session !== sessionName(res.locals.workspace, res.locals.socialId)) {
      return { provider: 'waha', connected: false }
    }
    const waha = new WahaClient(settings, request)
    const { status, phone } = await refreshWaha(session, waha)
    return {
      provider: 'waha', connected: status === 'WORKING' && !!phone,
      status, historyState: integration?.data?.wahaHistoryState, historyCount: integration?.data?.wahaHistoryCount,
      mediaLimitMb: settings.mediaLimitMb ?? 20, phoneNumberId: phone, displayPhone: phone === undefined ? undefined : '•••• ' + phone.slice(-4),
      qr: withQr && status === 'SCAN_QR_CODE' ? await waha.qr(session) : undefined
    }
  }

  app.post('/api/media', (req, res) => {
    void (async () => {
      const { id, employee, channel } = req.body ?? {}
      if (typeof id !== 'string' || id.length === 0 || id.length > 512) { res.sendStatus(400); return }
      const workspace = res.locals.workspace as WorkspaceUuid
      let session = sessionName(workspace, res.locals.socialId)
      let owner = res.locals.actor as AccountUuid
      let linked
      if (employee !== undefined) {
        if (typeof employee !== 'string' || typeof channel !== 'string' || receiver === undefined ||
          !await supervisorAllowed(res)) { res.sendStatus(403); return }
        const rows = await receiver.supervisionMessages(workspace, employee as AccountUuid, channel as Ref<Channel>)
        if (!rows.some((row) => row.mediaId === id)) { res.sendStatus(404); return }
        const candidates = (await store.list()).filter((item) => item.workspaceUuid === workspace)
        const checks = await Promise.all(candidates.map(async (item) => await receiver.ownsIntegration(item, employee)))
        const entry = candidates[checks.findIndex(Boolean)]
        if (entry === undefined) { res.sendStatus(404); return }
        owner = employee as AccountUuid
        linked = entry
        session = sessionName(workspace, entry.socialId)
        await receiver.auditAccess(workspace, res.locals.actor, 'WhatsApp supervision · employee ' + employee, channel)
      }
      let file = await media.read(session, id)
      if (file === undefined && waha !== undefined && receiver !== undefined) {
        const phone = await receiver.mediaPhone(workspace, owner, id)
        const entry = linked ?? await store.get(workspace, res.locals.socialId)
        if (phone !== undefined && entry?.data?.wahaSession === session && await receiver.ownsIntegration(entry, owner)) {
          const chat = phone.endsWith('@lid') ? phone : phone + '@c.us'
          const settings = await workspaceConfig(workspace)
          const imported = await store.wahaRequest(entry, settings, request, async (scoped) => {
            const remote = await new WahaClient(scoped, request).messageMedia(session, chat, id)
            return await new WahaMedia(scoped, request).save(session, id, remote)
          }).catch(() => false)
          if (imported) file = await media.read(session, id)
        }
      }
      if (file === undefined) { res.sendStatus(404); return }
      const details = await media.details(session, id)
      res.setHeader('X-WA-Name', encodeURIComponent(details.name))
      res.setHeader('X-WA-Mime', details.mime)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.attachment('whatsapp-attachment.bin').send(file)
    })().catch(() => res.sendStatus(503))
  })

  app.post('/api/send-media', express.raw({ type: 'application/octet-stream', limit: '100mb' }), (req, res) => {
    if (waha === undefined || receiver === undefined) { res.sendStatus(404); return }
    void (async () => {
      const workspace = res.locals.workspace as WorkspaceUuid
      const integration = await store.get(workspace, res.locals.socialId)
      const session = sessionName(workspace, res.locals.socialId)
      const ownPhone = integration?.data?.wahaPhone
      if (integration?.data?.wahaSession !== session || integration.data?.wahaStatus !== 'WORKING' ||
        typeof ownPhone !== 'string' || !await receiver.ownsIntegration(integration, res.locals.actor)) {
        res.sendStatus(403)
        return
      }
      const settings = await workspaceConfig(workspace)
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) { res.sendStatus(400); return }
      if (req.body.length > (settings.mediaLimitMb ?? 20) * 1024 * 1024) { res.sendStatus(413); return }
      const channel = req.get('X-WA-Channel')
      if (channel === undefined || channel.length > 512) { res.sendStatus(400); return }
      const phone = await receiver.attachmentRecipient(workspace, channel as Ref<Channel>)
      if (phone === undefined || phone === ownPhone) { res.sendStatus(400); return }
      const endpoint = await getTransactorEndpoint(res.locals.token, 'internal', 5000)
      const user = await createClient(endpoint, res.locals.token, undefined, 5000)
      try {
        const result = await user.domainRequest('whatsapp-media' as OperationDomain, {})
        if (result.value !== true) { res.sendStatus(403); return }
      } finally {
        await user.close()
      }
      const mime = req.get('X-WA-Mime') ?? 'application/octet-stream'
      if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)) { res.sendStatus(400); return }
      const filename = decodeURIComponent(req.get('X-WA-Name') ?? 'attachment').slice(0, 160)
      const caption = decodeURIComponent(req.get('X-WA-Caption') ?? '').slice(0, 4096)
      const id = await store.wahaRequest(integration, settings, request,
        async (scoped) => await new WahaClient(scoped, request).sendMedia(session, phone, req.body, mime, filename, caption))
      const stored = await media.write(session, id, req.body, { mimetype: mime, filename }).then(() => true).catch(() => false)
      await receiver.receive(await receiver.getClient(workspace), integration, {
        session, outgoing: true, phoneNumberId: ownPhone, phone, wamid: id, name: phone,
        timestamp: Date.now(), content: caption || '[文件]', mediaAvailable: stored
      })
      res.json({ sent: true })
    })().catch(() => res.status(503).json({ code: 'Failed' }))
  })

  app.post('/api/history/retry', (_req, res) => {
    void (async () => {
      const connection = await store.get(res.locals.workspace, res.locals.socialId)
      if (connection?.data?.wahaSession !== sessionName(res.locals.workspace, res.locals.socialId) ||
        connection.data?.wahaStatus !== 'WORKING') { res.sendStatus(409); return }
      onWorking?.()
      res.json({ scheduled: true })
    })().catch(() => res.sendStatus(503))
  })

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
              ...(await meta.status({
                workspace: res.locals.workspace, socialId: entry.socialId,
                phoneNumberId: entry.data?.phoneNumberId, token: await store.accessToken(entry)
              }))
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
        const settings = await workspaceConfig(res.locals.workspace)
        const client = new WahaClient(settings, request)
        if (!settings.wahaUrl || !settings.wahaApiKey || !settings.wahaWebhookSecret) {
          res.status(503).json({ code: 'Unavailable' })
          return
        }
        const session = sessionName(res.locals.workspace, res.locals.socialId)
        try {
          await client.bind(session)
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
        const integration = await meta.bind({
          workspace: res.locals.workspace, socialId: res.locals.socialId,
          phoneNumberId: req.body.phoneNumberId, wabaId: req.body.wabaId, token
        })
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
        if (connection !== undefined && session === sessionName(res.locals.workspace, res.locals.socialId)) {
          const admin = new WahaClient(await workspaceConfig(res.locals.workspace), request)
          await store.revokeWahaKey(connection, admin)
          await admin.disconnect(session)
        }
        await store.disconnectWaha(res.locals.workspace, res.locals.socialId)
        res.json({ connected: false })
      })().catch(() => res.status(503).json({ code: 'Failed' }))
      return
    }
    void meta
      .disconnect({ workspace: res.locals.workspace, socialId: res.locals.socialId })
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
