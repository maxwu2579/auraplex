// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.

export const departmentModuleSettingsClass = 'departments:class:ModuleSettings'
export const departmentModuleGrantClass = 'departments:class:ModuleGrant'
export const departmentModuleSettingsId = 'departments:ids:ModuleSettings'

const alwaysAvailable = ['inbox', 'chunter', 'departments', 'time', 'calendar']

export interface DepartmentModuleDefaults {
  members: readonly string[]
  administrators: readonly string[]
  archived: boolean
  modules?: readonly string[]
}

export interface DepartmentModuleException {
  extra: readonly string[]
  blocked: readonly string[]
}

/** Undefined means every application is available subject to its existing role checks. */
export function effectiveDepartmentModules (
  person: string,
  owner: boolean,
  enabled: boolean,
  departments: readonly DepartmentModuleDefaults[],
  grant?: DepartmentModuleException
): ((alias: string) => boolean) | undefined {
  if (owner || !enabled) return undefined
  const membership = departments.filter((dept) => !dept.archived && dept.members.includes(person))
  const all = membership.some((dept) => dept.modules === undefined)
  const allowed = new Set([...membership.flatMap((dept) => dept.modules ?? []), ...(grant?.extra ?? [])])
  const blocked = new Set(grant?.blocked)
  return (alias) => alwaysAvailable.includes(alias) || (!blocked.has(alias) && (all || allowed.has(alias)))
}

/** Check both additions and removals so a department admin cannot undo an unrelated exception. */
export function canChangeDepartmentModuleException (
  actor: string,
  person: string,
  departments: readonly DepartmentModuleDefaults[],
  allowed: ((alias: string) => boolean) | undefined,
  before: DepartmentModuleException,
  after: DepartmentModuleException
): boolean {
  const scope = departments.filter(
    (dept) => !dept.archived && dept.administrators.includes(actor) && dept.members.includes(person)
  )
  if (scope.length === 0) return false
  const changed = (old: readonly string[], next: readonly string[]): string[] =>
    [...old.filter((alias) => !next.includes(alias)), ...next.filter((alias) => !old.includes(alias))]
  return changed(before.extra, after.extra).every((alias) => allowed?.(alias) ?? true) &&
    changed(before.blocked, after.blocked).every(
      (alias) => scope.some((dept) => dept.modules === undefined || dept.modules.includes(alias))
    )
}
