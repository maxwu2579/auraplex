// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { canChangeDepartmentModuleException, effectiveDepartmentModules } from '../departmentPolicy'

const team = { members: ['admin', 'member'], administrators: ['admin'], archived: false, modules: ['orders'] }
const empty = { extra: [], blocked: [] }

test('module access combines live department defaults and exceptions and preserves essential apps', () => {
  const canUse = effectiveDepartmentModules('member', false, true, [
    team,
    { ...team, modules: ['tracking'] },
    { ...team, archived: true, modules: ['inventory'] }
  ], { extra: ['prospects'], blocked: ['orders', 'inbox'] })
  expect(['orders', 'tracking', 'prospects', 'inventory', 'inbox'].map((alias) => canUse?.(alias)))
    .toEqual([false, true, true, false, true])
  expect(effectiveDepartmentModules('member', false, true, [{ ...team, modules: undefined }])?.('anything')).toBe(true)
  expect(effectiveDepartmentModules('member', true, true, [])).toBeUndefined()
  expect(effectiveDepartmentModules('member', false, false, [])).toBeUndefined()
})

test('department admins can only change exceptions within their scope and module ceiling', () => {
  const allowed = (alias: string): boolean => alias === 'tracking'
  expect(canChangeDepartmentModuleException('admin', 'member', [team], allowed, empty,
    { extra: ['tracking'], blocked: ['orders'] })).toBe(true)
  expect(canChangeDepartmentModuleException('admin', 'member', [team], allowed, empty,
    { extra: ['orders'], blocked: [] })).toBe(false)
  expect(canChangeDepartmentModuleException('admin', 'member', [team], allowed, empty,
    { extra: [], blocked: ['tracking'] })).toBe(false)
  expect(canChangeDepartmentModuleException('admin', 'outsider', [team], allowed, empty, empty)).toBe(false)
})
