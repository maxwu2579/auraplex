// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountClient, IntegrationSecret } from '@hcengineering/account-client'
import type { WorkspaceUuid } from '@hcengineering/core'
import { isOverdue, orderDeadline, reminderRecipients, singaporeClock, workdays } from '../schedule'
import { ScheduledRecords } from '../scheduledRecords'

const now = Date.parse('2026-11-27T00:00:00Z')

test('Singapore local day and workday do not follow the service machine timezone', () => {
  expect(singaporeClock(now)).toMatchObject({ date: '2026-11-27', time: '08:00', weekday: 5 })
  expect(singaporeClock(now - 1000).time).toBe('07:59')
  const fridayUtc = Date.parse('2026-11-27T16:00:00Z')
  expect(singaporeClock(fridayUtc)).toMatchObject({ date: '2026-11-28', time: '00:00', weekday: 6 })
  expect(workdays.includes(singaporeClock(fridayUtc).weekday)).toBe(false)
})

test('late order stages include in-progress and approval but exclude completed or waiting stages', () => {
  const stage = { startedOn: now - 86_400_001, limitDays: 1 }
  expect(isOverdue(orderDeadline({ ...stage, status: 'active' }), false, now)).toBe(true)
  expect(isOverdue(orderDeadline({ ...stage, status: 'approval' }), false, now)).toBe(true)
  expect(isOverdue(orderDeadline({ ...stage, status: 'done' }), false, now)).toBe(false)
  expect(isOverdue(orderDeadline({ ...stage, status: 'waiting' }), false, now)).toBe(false)
  expect(isOverdue(orderDeadline({ ...stage, status: 'active', startedOn: now }), false, now)).toBe(false)
})

test.each(['tracker issue', 'planner to-do', 'approval to-do'])('%s needs an open task with a past due date', () => {
  expect(isOverdue(now - 1, false, now)).toBe(true)
  expect(isOverdue(now, false, now)).toBe(false)
  expect(isOverdue(now - 1, true, now)).toBe(false)
  expect(isOverdue(null, false, now)).toBe(false)
})

test('overdue reminders deduplicate the assignee and leads across departments', () => {
  const sales = { administrators: ['owner', 'max'], supervisors: ['lead', 'owner'] }
  const design = { employees: ['max'], administrators: ['owner', 'designer'] }
  const archived = { employees: ['max'], administrators: ['former'], archived: true }
  expect(reminderRecipients([sales, design, archived], 'max')).toEqual(['max', 'owner', 'lead', 'designer'])
  expect(reminderRecipients([sales, design], 'max', design)).toEqual(['max', 'owner', 'designer'])
})

function fakeAccount (): AccountClient {
  const db = new Map<string, IntegrationSecret>()
  return {
    getIntegrationSecret: async ({ key }) => db.get(key) ?? null,
    addIntegrationSecret: async (secret) => {
      if (db.has(secret.key)) throw new Error('Duplicate key')
      db.set(secret.key, secret)
    }
  } as AccountClient
}

test('the same due task and recipient can only be claimed once per day across workers and restarts', async () => {
  const account = fakeAccount()
  const a = new ScheduledRecords('fake-workspace' as WorkspaceUuid, account)
  const b = new ScheduledRecords('fake-workspace' as WorkspaceUuid, account)
  const sameDay = await Promise.all([
    a.claim('overdue', '2026-11-27', 'fake-task', 'fake-recipient'),
    b.claim('overdue', '2026-11-27', 'fake-task', 'fake-recipient')
  ])
  expect(sameDay.sort()).toEqual([false, true])
  const restarted = new ScheduledRecords('fake-workspace' as WorkspaceUuid, account)
  expect(await restarted.claim('overdue', '2026-11-27', 'fake-task', 'fake-recipient')).toBe(false)
  expect(await restarted.claim('overdue', '2026-11-30', 'fake-task', 'fake-recipient')).toBe(true)
})
