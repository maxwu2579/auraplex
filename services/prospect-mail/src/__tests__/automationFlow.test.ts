// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { ImapFlow } from 'imapflow'
import { SMTPServer } from 'smtp-server'
import nodemailer from 'nodemailer'
import type { AccountClient, IntegrationSecret } from '@hcengineering/account-client'
import type { AccountUuid, TxOperations, WorkspaceUuid } from '@hcengineering/core'
import contact from '@hcengineering/contact'
import notification from '@hcengineering/notification'
import prospects, { defaultAutomation } from '@hcengineering/prospects'
import time from '@hcengineering/time'
import { AutomatedMail, mailSlots } from '../automatedMail'
import { Forwarder } from '../forwarder'
import { pollInbox, type Cursor } from '../poller'
import { Receiver } from '../receiver'
import { forwardPendingReplies } from '../replyForwarder'
import { ScheduledRecords } from '../scheduledRecords'
import { Sender } from '../sender'

type FakeDoc = Record<string, any>
const owner = 'fake-owner' as AccountUuid
const supervisor = 'fake-supervisor' as AccountUuid
const workspace = 'fake-workspace' as WorkspaceUuid
const monday = Date.parse('2026-11-30T09:00:00+08:00')

function fakeRecords (): AccountClient {
  const map = new Map<string, IntegrationSecret>()
  return {
    getIntegrationSecret: async ({ key }) => map.get(key) ?? null,
    addIntegrationSecret: async (row) => {
      if (map.has(row.key)) throw new Error('Duplicate key')
      map.set(row.key, row)
    }
  } as AccountClient
}

function storage (): { client: TxOperations, rows: Map<string, FakeDoc[]> } {
  const rows = new Map<string, FakeDoc[]>()
  let version = 1
  const table = (cls: string): FakeDoc[] => {
    if (!rows.has(cls)) rows.set(cls, [])
    return rows.get(cls) ?? []
  }
  const find = (cls: string, query: FakeDoc): FakeDoc[] => table(cls).filter((row) => Object.entries(query).every(([field, value]) => {
    const actual = row[field]
    if (value === null || typeof value !== 'object') return actual === value
    if ('$exists' in value) return (actual !== undefined) === value.$exists
    if ('$in' in value) return value.$in.includes(actual)
    if ('$gte' in value) return actual >= value.$gte
    return false
  }))
  const update = (target: FakeDoc, patch: FakeDoc): void => {
    const { $inc, ...rest } = patch
    Object.assign(target, rest, { modifiedOn: version++ })
    for (const [key, delta] of Object.entries($inc ?? {})) target[key] = (target[key] ?? 0) + Number(delta)
  }
  const create = (cls: string, space: string, entry: FakeDoc, id: string): void => {
    table(cls).push({ ...entry, _id: id, _class: cls, space, modifiedOn: version++ })
  }
  const client = {
    findOne: async (cls: string, query: FakeDoc) => find(cls, query)[0],
    findAll: async (cls: string, query: FakeDoc) => find(cls, query),
    update: async (target: FakeDoc, patch: FakeDoc) => { update(target, patch) },
    apply: () => {
      const checks: Array<() => boolean> = []
      const writes: Array<() => void> = []
      return {
        match: (cls: string, query: FakeDoc) => { checks.push(() => find(cls, query).length > 0) },
        notMatch: (cls: string, query: FakeDoc) => { checks.push(() => find(cls, query).length === 0) },
        addCollection: async (cls: string, space: string, attachedTo: string, attachedToClass: string, collection: string, doc: FakeDoc, id: string) => {
          writes.push(() => { create(cls, space, { ...doc, attachedTo, attachedToClass, collection }, id) })
        },
        createDoc: async (cls: string, space: string, doc: FakeDoc, id: string) => {
          writes.push(() => { create(cls, space, doc, id) })
        },
        update: async (target: FakeDoc, patch: FakeDoc) => {
          writes.push(() => { update(target, patch) })
        },
        commit: async () => {
          if (!checks.every((check) => check())) return { result: false }
          for (const write of writes) write()
          return { result: true }
        }
      }
    }
  } as unknown as TxOperations
  return { client, rows }
}

test('fixed hourly slots total the daily quota and exclude evenings and weekends', () => {
  const slots = Array.from({ length: 8 }, (_, hour) => mailSlots(monday + hour * 3600000, 50)).flat()
  expect(slots).toHaveLength(50)
  expect(new Set(slots).size).toBe(50)
  expect(mailSlots(monday + 8 * 3600000, 50)).toEqual([])
  expect(mailSlots(monday - 2 * 86400000, 50)).toEqual([])
})

test('new card to fake SMTP, reply notification, one forward each and follow-up, with STOP handled separately', async () => {
  const received: string[] = []
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData (stream, _session, done) {
      let body = ''
      stream.on('data', (buffer: Buffer) => { body += buffer.toString() })
      stream.on('end', () => { received.push(body); done() })
    }
  })
  await new Promise<void>((resolve) => { smtp.listen(0, '127.0.0.1', resolve) })
  const address = smtp.server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing mock SMTP address')
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: address.port, secure: false, ignoreTLS: true })
  try {
    const { client, rows } = storage()
    const account = fakeRecords()
    const records = new ScheduledRecords(workspace, account)
    const first = new AutomatedMail(client, records)
    const second = new AutomatedMail(client, new ScheduledRecords(workspace, account))
    const start = monday - 4 * 86400000
    await first.action(owner, { op: 'settings', settings: {
      ...defaultAutomation, enabled: true, language: 'en', en: { subject: 'Hello {name}', body: 'Welcome' }
    } }, start)
    const customer = {
      _id: 'fake-card', space: 'fake-space', _class: prospects.class.Prospect,
      modifiedOn: 100, createdOn: start + 1, owner, name: 'Fake Customer', company: 'Fake Co',
      email: 'customer@example.test', normalizedEmail: 'customer@example.test', status: 'new', emailCount: 0
    }
    rows.set(prospects.class.Prospect, [customer, {
      ...customer, _id: 'cancelled-card', email: 'cancelled@example.test', normalizedEmail: 'cancelled@example.test'
    }])
    await first.action(owner, { op: 'remove-intro', id: 'cancelled-card' }, start + 1)
    const people = [owner, supervisor].map((user) => ({ _id: user, name: 'Fake User', personUuid: user, active: true }))
    rows.set(contact.class.Person, people)
    rows.set(contact.mixin.Employee, people)
    rows.set(contact.class.PersonSpace, people.map((person) => ({ _id: person._id + '-space', person: person._id })))
    rows.set(contact.class.SocialIdentity, people.map((person) => ({ attachedTo: person._id, type: 'email', verifiedOn: 1, value: person._id + '@example.test' })))
    const sender = new Sender(client, transport, 'company@example.test')
    const problem = jest.fn()
    const completed = jest.fn()
    await Promise.all([first.check(monday, sender, problem, completed), second.check(monday, sender, problem, completed)])
    await second.check(monday + 3600000, sender, problem, completed)
    expect(received).toHaveLength(1)
    expect(received[0]).toContain('Welcome')
    const outgoing = rows.get(prospects.class.ProspectMail)?.[0]
    expect(outgoing).toMatchObject({ automation: 'intro', delivery: 'sent' })
    const receiver = new Receiver(client, async () => [supervisor, owner])
    const reply = {
      uidValidity: 'fake-inbox', uid: 1, messageId: '<reply@example.test>', from: customer.email,
      subject: 'Re: Hello', text: 'What are your prices?', sentAt: Date.now(), references: [outgoing?.messageId]
    }
    const source = Buffer.from([
      'From: customer@example.test',
      'To: company@example.test',
      'Date: ' + new Date(reply.sentAt).toUTCString(),
      'Message-ID: ' + reply.messageId,
      'In-Reply-To: ' + outgoing?.messageId,
      'Subject: ' + reply.subject,
      'Content-Type: text/plain; charset=utf-8',
      '', reply.text
    ].join('\r\n'))
    let cursor: Cursor = { uidValidity: 'fake-inbox', uid: 0 }
    const imap = {
      connect: async () => {}, logout: async () => {},
      mailboxOpen: async () => ({ uidValidity: 'fake-inbox' }),
      search: async () => [1],
      fetchOne: async () => ({ size: source.length, source })
    } as unknown as ImapFlow
    await pollInbox(imap, {
      read: async () => cursor,
      write: async (next) => { cursor = next },
      accept: async (incoming) => await receiver.accept(incoming)
    })
    expect(cursor.uid).toBe(1)
    expect(await receiver.accept(reply)).toBe('duplicate')
    expect(await receiver.accept({ ...reply, uid: 10, messageId: '<wrong@example.test>', from: 'wrong@example.test' })).toBe('unmatched')
    expect(rows.get(notification.class.CommonInboxNotification)).toHaveLength(2)
    expect(rows.get(time.class.ToDo)).toHaveLength(1)
    const forwarder = new Forwarder(client, transport, 'company@example.test')
    await Promise.all([
      forwardPendingReplies(client, records, forwarder, problem),
      forwardPendingReplies(client, new ScheduledRecords(workspace, account), forwarder, problem)
    ])
    expect(received).toHaveLength(3)
    expect(received.slice(1).every((msg) => msg.includes('What are your prices?'))).toBe(true)
    expect(await receiver.accept({ ...reply, uid: 2, messageId: '<stop@example.test>', text: 'STOP' })).toBe('recorded')
    await forwardPendingReplies(client, records, forwarder, problem)
    expect(customer.status).toBe('do-not-send')
    expect(received).toHaveLength(3)
    expect(rows.get(time.class.ToDo)).toHaveLength(1)
    expect(rows.get(notification.class.CommonInboxNotification)).toHaveLength(3)
    expect(problem).not.toHaveBeenCalled()
  } finally {
    transport.close()
    await new Promise<void>((resolve) => { smtp.close(() => { resolve() }) })
  }
})


test('an active campaign freezes recipients and gives the first available slot to introductions', async () => {
  const { client, rows } = storage()
  const account = fakeRecords()
  const first = new AutomatedMail(client, new ScheduledRecords(workspace, account))
  const second = new AutomatedMail(client, new ScheduledRecords(workspace, account))
  const start = monday - 4 * 86_400_000
  await first.action(owner, { op: 'settings', settings: {
    ...defaultAutomation, enabled: true, limit: 8, language: 'en', en: { subject: 'Hello', body: 'Welcome' }
  } }, start)
  const make = (id: string, createdOn: number): FakeDoc => ({
    _id: id, _class: prospects.class.Prospect, name: id, owner, createdOn, modifiedOn: 50,
    email: id + '@example.test', normalizedEmail: id + '@example.test', status: 'new', emailCount: 0
  })
  const old = make('old', start - 1)
  rows.set(prospects.class.Prospect, [old])
  await first.action(owner, { op: 'create', start: '2026-11-30', title: 'Fake campaign',
    template: { subject: 'Sale', body: 'Details' } }, start)
  const scheduled = (await first.dashboard(monday)).campaign as { id: string, customers: string[] }
  expect(scheduled.customers).toEqual(['old'])
  rows.get(prospects.class.Prospect)?.push(make('newcomer', start + 1))
  await expect(first.action(owner, { op: 'create', start: '2026-11-30', title: 'Second',
    template: { subject: 'Second', body: 'Details' } }, start)).rejects.toThrow()
  const mail: FakeDoc[] = []
  rows.set(prospects.class.ProspectMail, mail)
  const sent = jest.fn(async (_actor: AccountUuid, prospectId: string, _id: string, _subject: string, _body: string,
    auto: { kind: string, campaign?: string }) => {
    mail.push({ attachedTo: prospectId, direction: 'outgoing', delivery: 'sent', automation: auto.kind, campaign: auto.campaign, sentAt: monday })
  })
  const sender = { send: sent } as unknown as Sender
  const onFinish = jest.fn()
  const onProblem = jest.fn()
  await first.check(monday, sender, onProblem, onFinish)
  expect(mail.map(({ attachedTo }) => attachedTo)).toEqual(['newcomer'])
  await first.action(owner, { op: 'pause', campaign: scheduled.id }, monday)
  await second.check(monday + 3_600_000, sender, onProblem, onFinish)
  expect(mail).toHaveLength(1)
  await first.action(owner, { op: 'resume', campaign: scheduled.id }, monday)
  await second.check(monday + 3_600_000, sender, onProblem, onFinish)
  await first.check(monday + 7_200_000, sender, onProblem, onFinish)
  expect(mail.map(({ attachedTo }) => attachedTo)).toEqual(['newcomer', 'old'])
  expect(onFinish).toHaveBeenCalledTimes(1)
  expect(onFinish.mock.calls[0][1]).toBe(1)
})
