// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.

export const departmentAutoJoinClasses: Record<string, string> = {
  tracker: 'tracker:class:Project',
  document: 'document:class:Teamspace',
  chunter: 'chunter:class:Channel',
  drive: 'drive:class:Drive'
}

export const departmentModuleSettingsClass = 'departments:class:ModuleSettings'
export const departmentModuleGrantClass = 'departments:class:ModuleGrant'
export const departmentModuleSettingsId = 'departments:ids:ModuleSettings'

const alwaysAvailable = ['inbox', 'chunter', 'departments', 'time', 'calendar']
export const moduleRoles = ['admin', 'supervisor', 'employee', 'reader'] as const
export type ModuleRole = typeof moduleRoles[number]
export type ModuleLevel = 'none' | 'view' | 'edit'
export type ModuleAccess = Record<string, Record<ModuleRole, ModuleLevel>>
export type ModuleExtra = Record<string, Exclude<ModuleLevel, 'none'>>
export const moduleLevelRank: Record<ModuleLevel, number> = { none: 0, view: 1, edit: 2 }

export interface DepartmentModuleDefaults {
  members: Record<ModuleRole, readonly string[]>
  archived: boolean
  modules?: readonly string[]
  moduleAccess?: ModuleAccess
}

export interface DepartmentModuleException {
  extra: ModuleExtra | readonly string[]
  blocked: readonly string[]
}

export function normalizeModuleExtra (extra: DepartmentModuleException['extra']): ModuleExtra {
  return Array.isArray(extra) ? Object.fromEntries(extra.map((alias) => [alias, 'edit'])) : extra as ModuleExtra
}

export function defaultModuleLevel (alias: string, role: ModuleRole, modules?: readonly string[]): ModuleLevel {
  if (alias === 'whatsapp') return 'edit'
  return modules !== undefined && !modules.includes(alias) ? 'none' : role === 'reader' ? 'view' : 'edit'
}

export function effectiveDepartmentModules (
  person: string,
  owner: boolean,
  enabled: boolean,
  departments: readonly DepartmentModuleDefaults[],
  grant?: DepartmentModuleException
): (alias: string) => ModuleLevel {
  if (owner || !enabled) return () => 'edit'
  const membership = departments.flatMap((dept) => dept.archived ? [] :
    moduleRoles.filter((role) => dept.members[role].includes(person)).map((role) => ({ dept, role })))
  const extra = normalizeModuleExtra(grant?.extra ?? {})
  const blocked = new Set(grant?.blocked)
  return (alias) => {
    if (alwaysAvailable.includes(alias)) return 'edit'
    if (blocked.has(alias)) return 'none'
    let level: ModuleLevel = Object.prototype.hasOwnProperty.call(extra, alias) ? extra[alias] : 'none'
    if (alias === 'whatsapp' && membership.length === 0 && level === 'none') return 'edit'
    for (const { dept, role } of membership) {
      const candidate = dept.moduleAccess === undefined ? defaultModuleLevel(alias, role, dept.modules) :
        dept.moduleAccess[alias]?.[role] ?? (alias === 'whatsapp' ? 'edit' : 'none')
      if (moduleLevelRank[candidate] > moduleLevelRank[level]) level = candidate
    }
    return alias === 'whatsapp' && level !== 'none' ? 'edit' : level
  }
}

export function canChangeDepartmentModuleException (
  actor: string,
  person: string,
  departments: readonly DepartmentModuleDefaults[],
  allowed: (alias: string) => ModuleLevel,
  before: DepartmentModuleException,
  after: DepartmentModuleException
): boolean {
  const scope = departments.filter((dept) => !dept.archived && dept.members.admin.includes(actor) &&
    moduleRoles.some((role) => dept.members[role].includes(person)))
  if (scope.length === 0) return false
  const previous = normalizeModuleExtra(before.extra)
  const next = normalizeModuleExtra(after.extra)
  for (const alias of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (previous[alias] === next[alias]) continue
    const rank = (level: ModuleLevel): number => moduleLevelRank[alias === 'whatsapp' && level !== 'none' ? 'edit' : level]
    if (Math.max(rank(previous[alias] ?? 'none'), rank(next[alias] ?? 'none')) >
      moduleLevelRank[allowed(alias)]) return false
  }
  return [...before.blocked, ...after.blocked].every((alias) =>
    before.blocked.includes(alias) === after.blocked.includes(alias) ||
    effectiveDepartmentModules(person, false, true, scope)(alias) !== 'none')
}
