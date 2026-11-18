// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { canChangeDepartmentModuleException, effectiveDepartmentModules, type DepartmentModuleDefaults } from '../departmentPolicy'

const team: DepartmentModuleDefaults = {
  members: { admin: ['admin'], supervisor: [], employee: ['member'], reader: ['reader'] },
  archived: false,
  modules: ['orders']
}

test('takes the highest level, applies legacy and new grants, and blocks exceptions', () => {
  const matrix: DepartmentModuleDefaults = {
    ...team,
    moduleAccess: { orders: { admin: 'edit', supervisor: 'none', employee: 'view', reader: 'none' } }
  }
  const level = effectiveDepartmentModules('member', false, true, [matrix, { ...team, archived: true }],
    { extra: { tracking: 'view', orders: 'edit' }, blocked: ['orders', 'inbox'] })
  expect(['orders', 'tracking', 'inbox', 'inventory'].map(level)).toEqual(['none', 'view', 'edit', 'none'])
  expect(effectiveDepartmentModules('member', false, true, [matrix, team])('orders')).toBe('edit')
  expect(effectiveDepartmentModules('reader', false, true, [team])('orders')).toBe('view')
  expect(effectiveDepartmentModules('reader', false, true, [], { extra: ['orders'], blocked: [] })('orders')).toBe('edit')
  expect(effectiveDepartmentModules('reader', false, false, [])('orders')).toBe('edit')
  expect(effectiveDepartmentModules('reader', true, true, [])('orders')).toBe('edit')
})

test('bounds both extra levels and blocked defaults to the administrator scope', () => {
  const empty = { extra: {}, blocked: [] }
  const allowed = () => 'view' as const
  expect(canChangeDepartmentModuleException('admin', 'member', [team], allowed, empty,
    { extra: { tracking: 'view' }, blocked: ['orders'] })).toBe(true)
  expect(canChangeDepartmentModuleException('admin', 'member', [team], allowed, empty,
    { extra: { tracking: 'edit' }, blocked: [] })).toBe(false)
  expect(canChangeDepartmentModuleException('admin', 'member', [team], allowed, empty,
    { extra: {}, blocked: ['tracking'] })).toBe(false)
  expect(canChangeDepartmentModuleException('admin', 'outsider', [team], allowed, empty, empty)).toBe(false)
})
