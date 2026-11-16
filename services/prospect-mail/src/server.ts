// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import express, { type NextFunction, type Request, type Response } from 'express'
import { getClient, isWorkspaceLoginInfo } from '@hcengineering/account-client'
import { AccountRole, type AccountUuid, type WorkspaceUuid } from '@hcengineering/core'
import { MailUserError } from './errors'

export interface MailConfig {
  accountsUrl: string
  workspace?: string
  address?: string
  password?: string
}
export interface MailBackend {
  send: (
    workspace: WorkspaceUuid,
    actor: AccountUuid,
    prospectId: string,
    requestId: string,
    subject: string,
    body: string
  ) => Promise<void>
  forward: (
    workspace: WorkspaceUuid,
    actor: AccountUuid,
    prospectId: string,
    replyId: string,
    requestId: string
  ) => Promise<void>
}
const requestIdPattern = /^[a-f0-9-]{36}$/i
const objectIdPattern = /^[a-zA-Z0-9:_-]{1,150}$/
export function createApp (
  config: MailConfig,
  backend: MailBackend,
  status: () => Record<string, unknown> = () => ({})
): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const authorization = req.get('authorization')
      if (authorization === undefined || !authorization.startsWith('Bearer ')) {
        res.sendStatus(401)
        return
      }
      try {
        const account = getClient(config.accountsUrl, authorization.slice(7))
        const login = await account.getLoginInfoByToken()
        if (
          !isWorkspaceLoginInfo(login) ||
          ![AccountRole.User, AccountRole.Maintainer, AccountRole.Owner, AccountRole.Admin].includes(login.role)
        ) {
          res.sendStatus(403)
          return
        }
        const members = await account.getWorkspaceMembers()
        if (!members.some((entry) => entry.person === login.account)) {
          res.sendStatus(403)
          return
        }
        if (config.workspace !== undefined && config.workspace !== '' && login.workspace !== config.workspace) {
          res.sendStatus(403)
          return
        }
        res.locals.workspace = login.workspace
        res.locals.actor = login.account
        next()
      } catch {
        res.sendStatus(401)
      }
    })()
  })
  app.use('/api', express.json({ limit: '80kb' }))
  const configured = (): boolean =>
    config.address !== undefined &&
    config.address !== '' &&
    config.password !== undefined &&
    config.password !== '' &&
    config.workspace !== undefined &&
    config.workspace !== ''
  app.get('/api/status', (_req, res) => {
    res.json({ ...status(), configured: configured(), address: configured() ? config.address : undefined })
  })
  app.post('/api/send', (req, res) => {
    void (async () => {
      if (!configured()) {
        res.status(503).json({ error: '邮件未配置' })
        return
      }
      const { prospectId, requestId, subject, body } = req.body ?? {}
      if (
        typeof prospectId !== 'string' ||
        !objectIdPattern.test(prospectId) ||
        typeof requestId !== 'string' ||
        !requestIdPattern.test(requestId) ||
        typeof subject !== 'string' ||
        subject.trim() === '' ||
        subject.length > 200 ||
        /[\r\n]/.test(subject) ||
        typeof body !== 'string' ||
        body.trim() === '' ||
        body.length > 30000
      ) {
        res.status(400).json({ error: '邮件内容无效' })
        return
      }
      try {
        await backend.send(res.locals.workspace, res.locals.actor, prospectId, requestId, subject.trim(), body)
        res.json({ ok: true })
      } catch (err) {
        if (err instanceof MailUserError) res.status(400).json({ error: err.message })
        else { res.status(409).json({ error: '发送没完成或结果不确定，请先到 Gmail 的“已发送”里看看，再在发送记录里标记。' }) }
      }
    })()
  })
  app.post('/api/forward', (req, res) => {
    void (async () => {
      if (!configured()) {
        res.status(503).json({ error: '邮件未配置' })
        return
      }
      const { prospectId, replyId, requestId } = req.body ?? {}
      if (
        typeof prospectId !== 'string' ||
        !objectIdPattern.test(prospectId) ||
        typeof replyId !== 'string' ||
        !objectIdPattern.test(replyId) ||
        typeof requestId !== 'string' ||
        !requestIdPattern.test(requestId)
      ) {
        res.status(400).json({ error: '转发请求无效' })
        return
      }
      try {
        await backend.forward(res.locals.workspace, res.locals.actor, prospectId, replyId, requestId)
        res.json({ ok: true })
      } catch (err) {
        if (err instanceof MailUserError) res.status(400).json({ error: err.message })
        else res.status(409).json({ error: '转发没完成或结果不确定，请先到 Gmail 的“已发送”里看看。' })
      }
    })()
  })
  app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: '请求无效' })
  })
  return app
}
