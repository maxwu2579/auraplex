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
import { parseWebhook, verifySignature, verifyChallenge, type WebhookBatch } from './webhook'

export function createApp (
  config: Config,
  store: ConnectionStore,
  inbox?: { enqueue: (batch: WebhookBatch) => Promise<void> }
): express.Express {
  const app = express()
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
      !verifyChallenge(req.query['hub.mode'], req.query['hub.verify_token'], config.verifyToken ?? '') ||
      typeof req.query['hub.challenge'] !== 'string'
    ) {
      res.sendStatus(403)
      return
    }
    res.type('text/plain').send(req.query['hub.challenge'])
  })
  app.post('/webhook', (req, res) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody
    if (raw === undefined || !verifySignature(raw, req.get('X-Hub-Signature-256'), config.appSecret ?? '')) {
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
      if (![AccountRole.Owner, AccountRole.Admin, AccountRole.Maintainer].includes(login.role)) {
        res.status(403).json({ code: 'Forbidden' })
        return
      }
      const socialIds = await account.getSocialIds()
      const social = socialIds.find((id) => (id.verifiedOn ?? 0) > 0 && id.isDeleted !== true)
      if (social === undefined) {
        res.sendStatus(403)
        return
      }
      res.locals.workspace = login.workspace
      res.locals.socialId = social._id
      res.locals.owner = login.workspace + ':' + login.account
      next()
    })().catch(() => {
      res.status(503).json({ code: 'Unavailable' })
    })
  })

  app.get('/api/key', (_req, res) => {
    res.json(encryption.createChallenge(res.locals.owner))
  })
  app.get('/api/connection', (_req, res) => {
    void store
      .get(res.locals.workspace)
      .then((integration) => {
        // Return a whitelist of non-secret fields only.
        res.json({
          connected: integration !== undefined,
          phoneNumberId: integration?.data?.phoneNumberId,
          wabaId: integration?.data?.wabaId,
          webhook: config.publicUrl + '/webhook',
          mode: config.graphVersion === 'mock' ? 'mock' : 'configured'
        })
      })
      .catch(() => {
        res.status(503).json({ code: 'Unavailable' })
      })
  })
  app.post('/api/connection', (req, res) => {
    void (async () => {
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
          token
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
    void store
      .disconnect(res.locals.workspace)
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
