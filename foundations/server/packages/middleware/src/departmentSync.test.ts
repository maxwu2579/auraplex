// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { planDepartmentSpaceMembers } from './departmentSync'

test('all workspace owners and department members are present once', () => {
  const result = planDepartmentSpaceMembers(
    { admin: ['admin'], supervisor: ['lead'], employee: ['worker'], reader: ['guest', 'worker'] },
    ['owner', 'admin', 'owner']
  )
  expect(result.members).toEqual(['admin', 'guest', 'lead', 'owner', 'worker'])
  expect(result.assignment.admin).toEqual(['admin', 'owner'])
  expect(result.assignment.reader).toEqual(['guest', 'worker'])
})
test('removing a member or owner removes their inherited membership', () => {
  const result = planDepartmentSpaceMembers({ admin: ['admin'], supervisor: [], employee: [], reader: [] }, ['owner'])
  expect(result.members).toEqual(['admin', 'owner'])
  expect(result.members).not.toContain('former')
})
