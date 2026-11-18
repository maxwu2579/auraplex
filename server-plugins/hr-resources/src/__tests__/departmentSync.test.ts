// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { type AccountUuid } from '@hcengineering/core'
import { type DepartmentAccess } from '@hcengineering/departments'
import { departmentSpaceMembers, nextIdentifier, planAutoMembership } from '../departmentSync'

const id = (s: string): AccountUuid => s as AccountUuid

test('space members are every department role plus the super admins, once each', () => {
  const access = {
    administrators: [id('a')],
    supervisors: [id('s'), id('a')],
    employees: [id('e')],
    readers: [id('r')]
  } as unknown as DepartmentAccess
  expect(departmentSpaceMembers(access, [id('o'), id('a')])).toEqual(['a', 'e', 'o', 'r', 's'])
})

test('task prefixes skip the ones already used', () => {
  expect(nextIdentifier(new Set())).toBe('DEP1')
  expect(nextIdentifier(new Set(['DEP1', 'DEP2', 'TSK']))).toBe('DEP3')
})

test('automatic memberships respect shared department targets and preserve existing members', () => {
  const manual = 'manual' as AccountUuid
  const automatic = 'automatic' as AccountUuid
  const owner = 'owner' as AccountUuid
  const original = planAutoMembership([manual, owner], [], new Set([manual, automatic]))
  expect(original).toEqual({ members: [manual, owner, automatic], departmentAdded: [automatic] })
  expect(planAutoMembership(original.members, original.departmentAdded, new Set([automatic]))).toEqual(original)
  expect(planAutoMembership(original.members, original.departmentAdded, new Set()).members).toEqual([manual, owner])
  expect(planAutoMembership(original.members, original.departmentAdded, new Set(), new Set([automatic])).members)
    .toEqual(original.members)
})
