// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid, Doc } from '@hcengineering/core'
import type { DepartmentAccess } from './index'
import { managedTaskPeople, taskSection, type ScheduledTask } from './tasks'

const actor = 'fake-actor' as AccountUuid
const member = 'fake-member' as AccountUuid
const unrelated = 'fake-other' as AccountUuid
const now = 1000
const end = 2000

test.each(['order', 'issue', 'todo', 'approval'] as const)('%s shares due, overdue and closed classification', (kind) => {
  const item: ScheduledTask = { source: {} as Doc, kind, title: 'Fake item', href: '/test', assignee: actor }
  expect(taskSection({ ...item, due: now - 1 }, actor, now, end)).toBe(0)
  expect(taskSection({ ...item, due: now + 1 }, actor, now, end)).toBe(1)
  expect(taskSection({ ...item, due: now - 1, done: true }, actor, now, end)).toBeUndefined()
  expect(taskSection({ ...item, due: now - 1 }, unrelated, now, end)).toBeUndefined()
})

test('only includes people in departments the actor leads, even when the person belongs to several', () => {
  const teams = [
    { administrators: [actor], employees: [member] },
    { supervisors: [actor], employees: [member] },
    { employees: [actor, unrelated] },
    { administrators: [actor], employees: [unrelated], archived: true }
  ] as DepartmentAccess[]
  expect(managedTaskPeople(teams, actor)).toEqual({ manages: true, people: new Set([actor, member]) })
  expect(managedTaskPeople(teams, unrelated)).toEqual({ manages: false, people: new Set() })
})
