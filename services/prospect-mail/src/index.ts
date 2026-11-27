// Copyright © 2026 Auraplex. Licensed under EPL-2.0.
import core, { AccountRole, SocialIdType, TxOperations, systemAccountUuid, type Client, type Ref, type WorkspaceUuid, type IntegrationKind, type PersonId } from '@hcengineering/core'
import contact from '@hcengineering/contact'
import { setMetadata } from '@hcengineering/platform'
import prospects, { type ProspectMailCursor } from '@hcengineering/prospects'
import serverClient, { createClient, getTransactorEndpoint } from '@hcengineering/server-client'
import serverToken, { generateToken } from '@hcengineering/server-token'
import { getClient } from '@hcengineering/account-client'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { readConfig } from './config'
import { AutomatedMail } from './automatedMail'
import { campaignCompletion } from './automationRunner'
import { canManageAutomation, prospectDepartments, prospectLeads } from './prospectPermissions'
import { Forwarder } from './forwarder'
import { pollInbox, type Cursor } from './poller'
import { forwardPendingReplies } from './replyForwarder'
import { Receiver } from './receiver'
import { Sender } from './sender'
import { createApp, type TaskMailBackend, type AutomationBackend } from './server'
import { singaporeClock, startScheduledChecks, workdays } from './schedule'
import { ScheduledRecords } from './scheduledRecords'
import { digestIsDue, formatDigest, sendDailyDigest } from './taskDigest'
import { taskMailLabel } from './taskMailLabels'
import { taskSnapshot } from './taskSnapshot'
import { recordTaskFailure, sendOverdueReminders, type SendTaskMail } from './taskReminders'

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

// Auraplex: read new credentials at each send or poll; no restart or secret response is needed.
async function workspaceSettings (workspace: WorkspaceUuid): Promise<typeof config> {
  const token = generateToken(systemAccountUuid, workspace, { service: 'prospect-mail' })
  const value = await getClient(config.accountsUrl, token).getIntegrationSecret({
    workspaceUuid: workspace, socialId: '0' as PersonId,
    kind: 'auraplex-service-settings' as IntegrationKind, key: 'mail-settings'
  })
  if (value == null) return config
  const settings = JSON.parse(value.secret)
  return {
    ...config,
    address: settings.mailAddress ?? config.address,
    password: settings.mailPassword ?? config.password,
    smtp: { ...config.smtp, host: settings.mailSmtpHost ?? config.smtp.host, port: settings.mailSmtpPort ?? config.smtp.port },
    imap: { ...config.imap, host: settings.mailImapHost ?? config.imap.host, port: settings.mailImapPort ?? config.imap.port }
  }
}

function smtp (value: typeof config): ReturnType<typeof nodemailer.createTransport> {
  return nodemailer.createTransport({
    host: value.smtp.host, port: value.smtp.port, secure: value.smtp.secure, ignoreTLS: !value.smtp.secure,
    auth: value.address === undefined ? undefined : { user: value.address, pass: value.password ?? '' }
  })
}

function taskAccount (workspace: WorkspaceUuid): ReturnType<typeof getClient> {
  return getClient(config.accountsUrl, generateToken(systemAccountUuid, workspace, { service: 'prospect-mail' }))
}

const mailConfigured = (value: typeof config): boolean => Boolean(value.address && value.password)

function taskSender (client: TxOperations, active: typeof config): SendTaskMail | undefined {
  const address = active.address
  if (!address || !active.password) return undefined
  const transport = nodemailer.createTransport({
    host: active.smtp.host, port: active.smtp.port, secure: active.smtp.secure,
    auth: { user: address, pass: active.password },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 25_000
  })
  return async (user, subject, text, html) => {
    const person = await client.findOne(contact.class.Person, { personUuid: user })
    if (person === undefined) throw new Error('No recipient person')
    const ids = await client.findAll(contact.class.SocialIdentity, {
      attachedTo: person._id, type: SocialIdType.EMAIL, verifiedOn: { $gt: 0 }, isDeleted: { $ne: true }
    })
    const email = ids[0]?.value
    if (email === undefined || !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email)) throw new Error('No verified recipient email')
    await transport.sendMail({ from: address, to: email, subject, text, html })
  }
}

function workbenchLink (workspaceUrl: string): string {
  return `${config.taskFrontUrl?.replace(/\/+$/, '') ?? ''}/workbench/${encodeURIComponent(workspaceUrl)}`
}

let lastDigestRun: string | undefined

async function checkScheduledTasks (now: number): Promise<void> {
  if (config.workspace === undefined) return
  const day = singaporeClock(now)
  const workspace = config.workspace as WorkspaceUuid
  const account = taskAccount(workspace)
  const records = new ScheduledRecords(workspace, account)
  const settings = await records.getDigest().catch(() => {
    recordTaskFailure('digest-settings')
    return undefined
  })
  const runKey = settings === undefined ? '' : `${day.date}:${settings.time}`
  const shouldDigest = settings !== undefined && lastDigestRun !== runKey && digestIsDue(settings, day)
  const shouldRemind = workdays.includes(day.weekday)
  if (!shouldRemind && !shouldDigest) return
  const [client, info, active] = await Promise.all([
    workspaceClient(workspace),
    account.getWorkspaceInfo(),
    workspaceSettings(workspace).catch(() => {
      recordTaskFailure('mail-config')
      return undefined
    })
  ])
  const send = active === undefined || config.taskFrontUrl === undefined ? undefined : taskSender(client, active)
  const includeDigest = shouldDigest && send !== undefined
  if (!shouldRemind && !includeDigest) return
  const snapshot = await taskSnapshot(client, workbenchLink(info.url), includeDigest ? day.end : now, includeDigest)
  const overdue = shouldRemind
    ? sendOverdueReminders(client, records, snapshot, send, now, day.date, recordTaskFailure)
        .catch(() => { recordTaskFailure('overdue-scan') })
    : undefined
  if (includeDigest) {
    const users = snapshot.employees.flatMap((employee) => employee.personUuid === undefined ? [] : [employee.personUuid])
    if (await sendDailyDigest(records, send, snapshot.tasks, users, day.date, now, day.end, recordTaskFailure)) {
      lastDigestRun = runKey
    }
  }
  await overdue
}

const taskMail: TaskMailBackend = {
  get: async (workspace) => {
    const [settings, active] = await Promise.all([
      new ScheduledRecords(workspace, taskAccount(workspace)).getDigest(),
      workspaceSettings(workspace)
    ])
    return { settings, smtpConfigured: mailConfigured(active), linkConfigured: config.taskFrontUrl !== undefined }
  },
  save: async (workspace, settings) => {
    await new ScheduledRecords(workspace, taskAccount(workspace)).setDigest(settings)
  },
  test: async (workspace, actor) => {
    try {
      const [client, active, info] = await Promise.all([
        workspaceClient(workspace), workspaceSettings(workspace), taskAccount(workspace).getWorkspaceInfo()
      ])
      const send = taskSender(client, active)
      if (send === undefined || config.taskFrontUrl === undefined) throw new Error('Task mail not configured')
      const { text, html } = formatDigest([{ title: taskMailLabel('TaskMailExampleTask'), href: workbenchLink(info.url), section: 0 }])
      await send(actor, `Auraplex · ${taskMailLabel('TaskMailTestSubject')}`, text, html)
    } catch (err) {
      recordTaskFailure('test-mail')
      throw err
    }
  }
}

async function automationFor (workspace: WorkspaceUuid): Promise<AutomatedMail> {
  return new AutomatedMail(await workspaceClient(workspace), new ScheduledRecords(workspace, taskAccount(workspace)))
}

const automation: AutomationBackend = {
  access: async (workspace, actor, role) => await canManageAutomation(await workspaceClient(workspace), actor, role),
  get: async (workspace) => await (await automationFor(workspace)).dashboard(),
  action: async (workspace, actor, input) => { await (await automationFor(workspace)).action(actor, input) }
}

async function checkAutomatedMail (now: number): Promise<void> {
  if (config.workspace === undefined) return
  const day = singaporeClock(now)
  if (!workdays.includes(day.weekday) || day.time < '09:00' || day.time >= '17:00') return
  const workspace = config.workspace as WorkspaceUuid
  const active = await workspaceSettings(workspace)
  if (!active.address || !active.password) return
  const client = await workspaceClient(workspace)
  const account = taskAccount(workspace)
  const records = new ScheduledRecords(workspace, account)
  await new AutomatedMail(client, records).check(
    now, new Sender(client, smtp(active), active.address), () => { recordTaskFailure('prospect-auto-smtp') },
    async (campaign, count) => { await campaignCompletion(client, account, records, taskSender(client, active), campaign, count) }
  )
}

let lastPoll: { at: number, ok: boolean, error?: string } | undefined
async function pollOnce (): Promise<void> {
  if (config.workspace === undefined) return
  const active = await workspaceSettings(config.workspace as WorkspaceUuid)
  if (active.address === undefined || active.password === undefined) return
  const workspace = config.workspace as WorkspaceUuid
  const client = await workspaceClient(workspace)
  const account = taskAccount(workspace)
  const records = new ScheduledRecords(workspace, account)
  const receiver = new Receiver(client, async () => {
    const teams = await prospectDepartments(client)
    if (teams.some((team) => !team.archived && team.modules?.includes('prospects'))) return prospectLeads(teams)
    const members = await account.getWorkspaceMembers()
    return prospectLeads(teams, members.filter((member) => member.role === AccountRole.Owner).map((member) => member.person))
  })
  const imap = new ImapFlow({
    host: active.imap.host,
    port: active.imap.port,
    secure: active.imap.secure,
    auth: { user: active.address, pass: active.password },
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
  await forwardPendingReplies(client, records, new Forwarder(client, smtp(active), active.address), recordTaskFailure)
}
function schedule (delay = Math.min(config.pollMs, 60_000)): void {
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
      const active = await workspaceSettings(workspace)
      await new Sender(client, smtp(active), active.address ?? '').send(actor, prospectId, requestId, subject, body)
    },
    forward: async (workspace, actor, prospectId, replyId, requestId) => {
      const client = await workspaceClient(workspace)
      const active = await workspaceSettings(workspace)
      await new Forwarder(client, smtp(active), active.address ?? '').forward(actor, prospectId, replyId, requestId)
    }
  },
  () => ({ lastPoll }),
  workspaceSettings,
  taskMail,
  automation
).listen(config.port)
schedule(5000)
startScheduledChecks(checkAutomatedMail, () => { recordTaskFailure('prospect-auto-scan') })
startScheduledChecks(checkScheduledTasks, () => { recordTaskFailure('scan') })
console.info(JSON.stringify({ event: 'started', configured: config.address !== undefined }))
