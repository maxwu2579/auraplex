// Copyright © 2026 Auraplex. Licensed under EPL-2.0.
import core, { TxOperations, systemAccountUuid, type Client, type Ref, type WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import prospects, { type ProspectMailCursor } from '@hcengineering/prospects'
import serverClient, { createClient, getTransactorEndpoint } from '@hcengineering/server-client'
import serverToken, { generateToken } from '@hcengineering/server-token'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { readConfig } from './config'
import { Forwarder } from './forwarder'
import { pollInbox, type Cursor } from './poller'
import { Receiver } from './receiver'
import { Sender } from './sender'
import { createApp } from './server'

const config = readConfig(process.env)
setMetadata(serverClient.metadata.Endpoint, config.accountsUrl)
setMetadata(serverToken.metadata.Secret, config.secret)
setMetadata(serverToken.metadata.Service, 'prospect-mail')

const cursorId = 'prospect-mail-cursor' as Ref<ProspectMailCursor>
let pending: Promise<TxOperations> | undefined
async function workspaceClient (workspace: WorkspaceUuid): Promise<TxOperations> {
  if (pending === undefined) {
    pending = (async () => {
      const token = generateToken(systemAccountUuid, workspace, { service: 'prospect-mail' })
      const endpoint = await getTransactorEndpoint(token, 'internal', 15000)
      const raw: Client = await createClient(endpoint, token, undefined, 15000)
      return new TxOperations(raw, core.account.System)
    })()
  }
  try {
    return await pending
  } catch (err) {
    pending = undefined
    throw err
  }
}

const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  ignoreTLS: !config.smtp.secure,
  auth: config.address === undefined ? undefined : { user: config.address, pass: config.password ?? '' }
})

let lastPoll: { at: number, ok: boolean, error?: string } | undefined
async function pollOnce (): Promise<void> {
  if (config.workspace === undefined || config.address === undefined || config.password === undefined) return
  const client = await workspaceClient(config.workspace as WorkspaceUuid)
  const receiver = new Receiver(client)
  const imap = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user: config.address, pass: config.password },
    logger: false
  })
  imap.on('error', () => {})
  await pollInbox(imap, {
    read: async () => {
      const doc = await client.findOne(prospects.class.ProspectMailCursor, { _id: cursorId })
      return doc === undefined ? undefined : { uidValidity: doc.uidValidity, uid: doc.uid }
    },
    write: async (cursor: Cursor) => {
      const doc = await client.findOne(prospects.class.ProspectMailCursor, { _id: cursorId })
      if (doc === undefined) {
        await client.createDoc(prospects.class.ProspectMailCursor, core.space.Workspace, cursor, cursorId)
      } else {
        await client.update(doc, cursor)
      }
    },
    accept: async (reply) => await receiver.accept(reply)
  })
}
function schedule (delay = config.pollMs): void {
  setTimeout(() => {
    void pollOnce()
      .then(() => {
        lastPoll = { at: Date.now(), ok: true }
      })
      .catch((err) => {
        // Never log the error object itself: some libraries include credentials in it.
        const authFailed = (err as { authenticationFailed?: boolean })?.authenticationFailed === true
        lastPoll = { at: Date.now(), ok: false, error: authFailed ? '邮箱登录失败' : '收信失败' }
        console.error(JSON.stringify({ event: 'poll-failed', authFailed }))
      })
      .finally(() => {
        schedule()
      })
  }, delay)
}

createApp(
  config,
  {
    send: async (workspace, actor, prospectId, requestId, subject, body) => {
      const client = await workspaceClient(workspace)
      await new Sender(client, transport, config.address ?? '').send(actor, prospectId, requestId, subject, body)
    },
    forward: async (workspace, actor, prospectId, replyId, requestId) => {
      const client = await workspaceClient(workspace)
      await new Forwarder(client, transport, config.address ?? '').forward(actor, prospectId, replyId, requestId)
    }
  },
  () => ({ lastPoll })
).listen(config.port)
schedule(5000)
console.info(JSON.stringify({ event: 'started', configured: config.address !== undefined }))
