// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.

export type DepartmentPermission = 'create' | 'update' | 'delete' | 'comment' | 'invite' | 'manageMembers'
export type DepartmentRole = 'admin' | 'supervisor' | 'employee' | 'reader'
export const departmentRoles: DepartmentRole[] = ['admin', 'supervisor', 'employee', 'reader']
export const departmentPermissions: DepartmentPermission[] = [
  'create',
  'update',
  'delete',
  'comment',
  'invite',
  'manageMembers'
]
export type DepartmentPolicy = Record<DepartmentRole, DepartmentPermission[]>
export type DepartmentMembers = Record<DepartmentRole, string[]>

/** Object kind and ownership must be resolved from trusted server-side data. */
export function permissionForAction (
  action: 'create' | 'update' | 'remove' | 'mixin' | 'unknown',
  object: 'comment' | 'reaction' | 'commentAttachment' | 'ordinary',
  ownsComment = false
): DepartmentPermission | undefined {
  // Comment messages, reactions and attachments to verified comments use
  // comment on creation. Tasks, other activity and attachments use create.
  if (action === 'remove') return (object === 'comment' || object === 'reaction') && ownsComment ? 'comment' : 'delete'
  if (action === 'create') return object === 'ordinary' ? 'create' : 'comment'
  if (action === 'update' || action === 'mixin') return object === 'comment' && ownsComment ? 'comment' : 'update'
  return undefined
}
export const defaultDepartmentPolicy: DepartmentPolicy = {
  admin: [...departmentPermissions],
  supervisor: ['create', 'update', 'comment', 'invite'],
  employee: ['create', 'update', 'comment'],
  reader: ['comment']
}

function subset (permissions: DepartmentPermission[], allowed: Set<DepartmentPermission>): boolean {
  return permissions.every((permission) => allowed.has(permission))
}

export function effectivePermissions (
  members: DepartmentMembers,
  policy: DepartmentPolicy,
  actor: string
): Set<DepartmentPermission> {
  const permissions = new Set<DepartmentPermission>()
  for (const role of departmentRoles) {
    if (members[role].includes(actor)) {
      for (const permission of policy[role]) permissions.add(permission)
      if (role === 'admin') for (const permission of policy.supervisor) permissions.add(permission)
    }
  }
  return permissions
}

/** Compare complete old and new snapshots, not the client-supplied patch alone. */
export function canChangeDepartment (
  actor: string,
  privileged: boolean,
  before: DepartmentMembers,
  after: DepartmentMembers,
  oldPolicy: DepartmentPolicy,
  nextPolicy: DepartmentPolicy
): boolean {
  if (!privileged && before.admin.length > 0 && after.admin.length === 0) return false
  for (const role of departmentRoles) {
    if (new Set(after[role]).size !== after[role].length) return false
    if (nextPolicy[role].some((permission) => !departmentPermissions.includes(permission))) return false
  }
  // Administrators inherit all supervisor permissions; keep that within their ceiling.
  if (!subset(nextPolicy.supervisor, new Set(nextPolicy.admin))) return false
  if (privileged) return true
  const allowed = effectivePermissions(before, oldPolicy, actor)
  const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((item) => b.includes(item))
  if (allowed.has('manageMembers')) {
    if (!same(oldPolicy.admin, nextPolicy.admin)) return false
    if (!same(before.admin, after.admin)) return false
    for (const role of departmentRoles) {
      if (!same(oldPolicy[role], nextPolicy[role]) && !subset(nextPolicy[role], allowed)) return false
      if (after[role].some((id) => !before[role].includes(id)) && !subset(nextPolicy[role], allowed)) return false
    }
    return true
  }
  if (!allowed.has('invite')) return false
  if (departmentRoles.some((role) => !same(oldPolicy[role], nextPolicy[role]))) return false
  if (departmentRoles.filter((role) => role !== 'reader').some((role) => !same(before[role], after[role]))) return false
  if (!before.reader.every((id) => after.reader.includes(id))) return false
  return subset(nextPolicy.reader, allowed)
}
