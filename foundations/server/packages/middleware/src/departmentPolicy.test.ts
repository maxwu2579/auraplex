// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import {
  canChangeDepartment,
  defaultDepartmentPolicy,
  effectivePermissions,
  type DepartmentMembers,
  type DepartmentPolicy
} from './departmentPolicy'

function sample (): { members: DepartmentMembers, policy: DepartmentPolicy } {
  return {
    members: { admin: ['admin'], supervisor: ['supervisor'], employee: ['employee'], reader: [] },
    policy: structuredClone(defaultDepartmentPolicy)
  }
}
test('reader can comment but has no create, update or delete permission', () => {
  const { members, policy } = sample()
  members.reader.push('visitor')
  expect([...effectivePermissions(members, policy, 'visitor')]).toEqual(['comment'])
})
test('administrator inherits supervisor permissions', () => {
  const { members, policy } = sample()
  policy.admin = ['manageMembers']
  expect(effectivePermissions(members, policy, 'admin').has('create')).toBe(true)
})
test('administrator without delete cannot grant a role or add delete to a role', () => {
  const { members, policy } = sample()
  policy.admin = policy.admin.filter((permission) => permission !== 'delete')
  const after = structuredClone(members)
  const changed = structuredClone(policy)
  changed.employee.push('delete')
  expect(canChangeDepartment('admin', false, members, members, policy, changed)).toBe(false)
  policy.employee.push('delete')
  after.employee.push('visitor')
  expect(canChangeDepartment('admin', false, members, after, policy, policy)).toBe(false)
})
test('supervisor may only add readers and cannot change a template', () => {
  const { members, policy } = sample()
  const after = structuredClone(members)
  after.reader.push('visitor')
  expect(canChangeDepartment('supervisor', false, members, after, policy, policy)).toBe(true)
  after.employee.push('visitor')
  expect(canChangeDepartment('supervisor', false, members, after, policy, policy)).toBe(false)
  after.employee.pop()
  const changed = structuredClone(policy)
  changed.reader.push('create')
  expect(canChangeDepartment('supervisor', false, members, after, policy, changed)).toBe(false)
})
test('only owner or system can change administrators', () => {
  const { members, policy } = sample()
  const after = structuredClone(members)
  after.admin = []
  expect(canChangeDepartment('admin', false, members, after, policy, policy)).toBe(false)
  expect(canChangeDepartment('owner', true, members, after, policy, policy)).toBe(true)
  expect(canChangeDepartment('system', true, members, after, policy, policy)).toBe(true)
})
