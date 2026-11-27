// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid } from '@hcengineering/core'
import type { DepartmentAccess } from '@hcengineering/departments'
import { prospectLeads } from '../prospectPermissions'
import { nextWorkdayEnd, replyPeople } from '../replyFollowUp'

const users = ['owner', 'supervisor', 'admin', 'fallback'].map((name) => name as AccountUuid)
const [owner, supervisor, admin, fallback] = users

test('unions owner, sender and responsible departments and only uses workspace owners as fallback', () => {
  const teams = [
    { administrators: [owner, admin], supervisors: [supervisor], modules: ['prospects'] },
    { administrators: [fallback], modules: [], supervisors: [] }
  ] as DepartmentAccess[]
  expect(replyPeople(owner, owner, prospectLeads(teams, [fallback]), false)).toEqual([owner, admin, supervisor])
  expect(replyPeople(owner, supervisor, prospectLeads([], [fallback]), false)).toEqual([owner, supervisor, fallback])
  expect(replyPeople(owner, supervisor, prospectLeads(teams, [fallback]), true)).toEqual([owner])
})

test('on Friday or Saturday follow-up is due Monday at 23:59:59 Singapore time', () => {
  const expected = new Date('2026-11-30T23:59:59.999+08:00').getTime()
  expect(nextWorkdayEnd(Date.parse('2026-11-27T14:30:00+08:00'))).toBe(expected)
  expect(nextWorkdayEnd(Date.parse('2026-11-28T14:30:00+08:00'))).toBe(expected)
})
