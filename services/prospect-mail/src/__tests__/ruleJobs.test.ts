// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { Order } from '@hcengineering/departments'
import { overdueEvents } from '../ruleJobs'

const day = 86_400_000
const now = Date.parse('2026-11-27T04:00:00Z')
const order = (startedOn: number, patch: Partial<Order> = {}): Order => ({
  _id: 'fake-order', _class: 'departments:class:Order', number: 'ORD-9', title: 'fake', customer: 'fake', salesOwner: 'fake-sales',
  state: 'active', current: 0,
  stages: [{ id: 'production', name: '生产', department: 'fake-dept', status: 'active', startedOn, limitDays: 2, steps: [] }],
  ...patch
} as unknown as Order)

test('overdue stages become one rule event per stage start', () => {
  expect(overdueEvents([order(now - day)], now)).toEqual([])
  const events = overdueEvents([order(now - 3 * day)], now)
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ kind: 'stageOverdue', stageId: 'production', departments: ['fake-dept'] })
  // The same overdue stage keeps the same key (so the rule runs once); a restarted stage gets a new one.
  expect(overdueEvents([order(now - 3 * day)], now + day)[0].key).toBe(events[0].key)
  expect(overdueEvents([order(now - 4 * day)], now)[0].key).not.toBe(events[0].key)
  expect(overdueEvents([order(now - 3 * day, { state: 'cancelled' })], now)).toEqual([])
})
