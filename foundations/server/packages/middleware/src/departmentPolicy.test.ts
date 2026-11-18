// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import {
  canChangeDepartment,
  defaultDepartmentPolicy,
  effectivePermissions,
  permissionForAction,
  departmentPermissions,
  type DepartmentMembers,
  type DepartmentPolicy
} from './departmentPolicy'
import { canChangeDepartmentOptions } from './departmentPolicy'
import { readFileSync } from 'fs'
import { resolve } from 'path'

test('server permission names match the departments plugin definition', () => {
  const source = readFileSync(resolve(__dirname, '../../../../../plugins/departments/src/index.ts'), 'utf8')
  const union = source.match(/export type DepartmentPermission\s*=([^\n]+)/)
  expect(union).not.toBeNull()
  const names = [...(union?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1])
  expect(names.sort()).toEqual([...departmentPermissions].sort())
})

test('all department model field labels exist in both Chinese and English', () => {
  const root = resolve(__dirname, '../../../../..')
  const model = readFileSync(resolve(root, 'models/departments/src/index.ts'), 'utf8')
  const fields = [...model.matchAll(/@Prop\([^\n]+departments\.string\.(\w+)/g)].map((match) => match[1])
  const en = JSON.parse(readFileSync(resolve(root, 'plugins/departments-assets/lang/en.json'), 'utf8')).string
  const zh = JSON.parse(readFileSync(resolve(root, 'plugins/departments-assets/lang/zh.json'), 'utf8')).string
  expect(fields.length).toBeGreaterThanOrEqual(12)
  for (const label of fields) {
    expect(en[label]).toBeTruthy()
    expect(zh[label]).toBeTruthy()
  }
})

test('maps object actions conservatively', () => {
  expect(permissionForAction('create', 'comment')).toBe('comment')
  expect(permissionForAction('create', 'reaction')).toBe('comment')
  expect(permissionForAction('create', 'commentAttachment')).toBe('comment')
  expect(permissionForAction('create', 'ordinary')).toBe('create')
  expect(permissionForAction('update', 'comment', true)).toBe('comment')
  expect(permissionForAction('update', 'comment', false)).toBe('update')
  expect(permissionForAction('mixin', 'ordinary')).toBe('update')
  expect(permissionForAction('remove', 'comment', true)).toBe('comment')
  expect(permissionForAction('remove', 'reaction', true)).toBe('comment')
  expect(permissionForAction('remove', 'comment', false)).toBe('delete')
  expect(permissionForAction('remove', 'reaction', false)).toBe('delete')
  expect(permissionForAction('remove', 'ordinary', true)).toBe('delete')
  expect(permissionForAction('unknown', 'ordinary')).toBeUndefined()
})

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

test('invitation follows permissions even for administrators without manageMembers', () => {
  const { members, policy } = sample()
  policy.admin = policy.admin.filter((permission) => permission !== 'manageMembers')
  const after = structuredClone(members)
  after.reader.push('visitor')
  expect(canChangeDepartment('admin', false, members, after, policy, policy)).toBe(true)
  after.employee.push('visitor')
  expect(canChangeDepartment('admin', false, members, after, policy, policy)).toBe(false)
  after.employee.pop()
  after.admin.push('visitor')
  expect(canChangeDepartment('admin', false, members, after, policy, policy)).toBe(false)
})

test('owner and system must still supply valid data', () => {
  const { members, policy } = sample()
  const duplicate = structuredClone(members)
  duplicate.reader = ['visitor', 'visitor']
  const unknown = structuredClone(policy)
  unknown.reader.push('bogus' as any)
  const excessive = structuredClone(policy)
  excessive.admin = excessive.admin.filter((permission) => permission !== 'create')
  for (const actor of ['owner', 'system']) {
    expect(canChangeDepartment(actor, true, members, duplicate, policy, policy)).toBe(false)
    expect(canChangeDepartment(actor, true, members, members, policy, unknown)).toBe(false)
    expect(canChangeDepartment(actor, true, members, members, policy, excessive)).toBe(false)
  }
})

test('manageMembers is sufficient regardless of assigned role and respects the actor ceiling', () => {
  const { members, policy } = sample()
  policy.supervisor.push('manageMembers')
  const after = structuredClone(members)
  after.employee.push('visitor')
  expect(canChangeDepartment('supervisor', false, members, after, policy, policy)).toBe(true)
  const elevated = structuredClone(policy)
  elevated.employee.push('delete')
  expect(canChangeDepartment('supervisor', false, members, after, policy, elevated)).toBe(false)
})

test('only department administrators change contact visibility and only owners change module defaults', () => {
  expect(canChangeDepartmentOptions(false, false, {}, { contactVisibility: 'admins' })).toBe(false)
  expect(canChangeDepartmentOptions(false, true, {}, { contactVisibility: 'admins' })).toBe(true)
  expect(canChangeDepartmentOptions(false, true, {}, { modules: [] })).toBe(false)
  expect(canChangeDepartmentOptions(true, false, {}, { modules: ['orders'] })).toBe(true)
  expect(canChangeDepartmentOptions(true, false, {}, { contactVisibility: 'invalid' })).toBe(false)
})
