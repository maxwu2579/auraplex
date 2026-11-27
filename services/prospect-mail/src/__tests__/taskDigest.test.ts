// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountClient, IntegrationSecret } from '@hcengineering/account-client'
import type { AccountUuid, Doc, WorkspaceUuid } from '@hcengineering/core'
import { singaporeClock } from '../schedule'
import { ScheduledRecords } from '../scheduledRecords'
import { defaultDigest, digestIsDue, digestRows, formatDigest, parseDigestSettings, sendDailyDigest } from '../taskDigest'
import type { ScheduledTask } from '../taskSnapshot'

const employee = 'employee-a' as AccountUuid
const other = 'employee-b' as AccountUuid
const now = Date.parse('2026-11-27T00:00:00.000Z')
const day = singaporeClock(now)
const href = 'https://team.test/workbench/fake-workspace'
const source = {} as Doc

function accounts (): AccountClient {
  const rows = new Map<string, IntegrationSecret>()
  return {
    getIntegrationSecret: async ({ key }) => rows.get(key) ?? null,
    addIntegrationSecret: async (row) => {
      if (rows.has(row.key)) throw new Error('Duplicate key')
      rows.set(row.key, row)
    },
    updateIntegrationSecret: async (row) => { rows.set(row.key, row) }
  } as AccountClient
}

const workspace = 'fake-workspace' as WorkspaceUuid

test('default digest runs at 08:00 Singapore on weekdays and accepts explicitly configured weekends', () => {
  expect(digestIsDue(defaultDigest, singaporeClock(now - 1000))).toBe(false)
  expect(digestIsDue(defaultDigest, day)).toBe(true)
  const saturday = singaporeClock(now + 86_400_000)
  expect(digestIsDue(defaultDigest, saturday)).toBe(false)
  expect(digestIsDue({ ...defaultDigest, days: [6] }, saturday)).toBe(true)
  expect(digestIsDue({ ...defaultDigest, enabled: false }, day)).toBe(false)
  expect(parseDigestSettings({ enabled: true, time: '8am', days: [7] })).toBeUndefined()
  expect(parseDigestSettings({ enabled: true, time: '08:00', days: [] })).toBeUndefined()
})

test('persists and reloads the settings', async () => {
  const account = accounts()
  const a = new ScheduledRecords(workspace, account)
  expect(await a.getDigest()).toEqual(defaultDigest)
  await a.setDigest({ enabled: true, time: '11:40', days: [6] })
  const b = new ScheduledRecords(workspace, account)
  expect(await b.getDigest()).toEqual({ enabled: true, time: '11:40', days: [6] })
  await b.setDigest({ enabled: false, time: '11:40', days: [] })
  expect(await a.getDigest()).toEqual({ enabled: false, time: '11:40', days: [] })
})

test('places overdue first, separates today and pending approvals, and escapes mail HTML', () => {
  const tasks: ScheduledTask[] = [
    { source, title: 'Today', assignee: employee, href, due: now + 3600000 },
    { source, title: '<example>', assignee: employee, href, due: now - 1 },
    { source, title: 'Review the form', approvers: [employee], href },
    { source, title: 'Their task', assignee: other, href, due: now - 1 }
  ]
  const rows = digestRows(tasks, employee, now, day.end)
  expect(rows.map(({ title, section }) => [title, section])).toEqual([['<example>', 0], ['Today', 1], ['Review the form', 3]])
  const { html } = formatDigest(rows)
  expect(html).toContain('&lt;example&gt;')
  expect(html).toContain('color:#a82725')
  expect(html).toContain(`href="${href}"`)
})

test('sends only one non-empty digest per employee and day, even during concurrent runs and restarts', async () => {
  const account = accounts()
  const tasks: ScheduledTask[] = [{ source, title: 'Fake task', assignee: employee, href, due: now - 1 }]
  const send = jest.fn()
  const fail = jest.fn()
  const run = async (date = day.date): Promise<boolean> =>
    await sendDailyDigest(new ScheduledRecords(workspace, account), send, tasks, [employee, other],
      date, now, day.end, fail)
  await Promise.all([run(), run()])
  await run()
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0][0]).toBe(employee)
  await run('2026-11-30')
  expect(send).toHaveBeenCalledTimes(2)
  expect(fail).not.toHaveBeenCalled()
})

test('SMTP failures are logged by channel and can be followed by the next day’s digest', async () => {
  const records = new ScheduledRecords(workspace, accounts())
  const tasks: ScheduledTask[] = [{ source, title: 'Fake task', assignee: employee, href, due: now - 1 }]
  const send = jest.fn().mockRejectedValueOnce(new Error('sensitive SMTP diagnostic'))
  const fail = jest.fn()
  await sendDailyDigest(records, send, tasks, [employee], day.date, now, day.end, fail)
  await sendDailyDigest(records, send, tasks, [employee], day.date, now, day.end, fail)
  await sendDailyDigest(records, send, tasks, [employee], '2026-11-30', now, day.end, fail)
  expect(send).toHaveBeenCalledTimes(2)
  expect(fail.mock.calls).toEqual([['daily-mail']])
})
