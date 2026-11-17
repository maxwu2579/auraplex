// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { departmentRoles, type DepartmentMembers, type DepartmentRole } from './departmentPolicy'

/** Same membership and role assignment applies to all three department spaces. */
export function planDepartmentSpaceMembers (
  members: DepartmentMembers,
  workspaceOwners: readonly string[]
): {
    members: string[]
    assignment: Record<DepartmentRole, string[]>
  } {
  const assignment: Record<DepartmentRole, string[]> = {
    admin: [],
    supervisor: [],
    employee: [],
    reader: []
  }
  for (const role of departmentRoles) assignment[role] = Array.from(new Set(members[role])).sort()
  assignment.admin = Array.from(new Set([...assignment.admin, ...workspaceOwners])).sort()
  return {
    members: Array.from(new Set(departmentRoles.flatMap((role) => assignment[role]))).sort(),
    assignment
  }
}
