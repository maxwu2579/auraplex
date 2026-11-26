// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import type { AccountUuid, Ref } from '@hcengineering/core'
import type { Department } from '@hcengineering/hr'
import type { DepartmentAccess } from './index'

/** Stable primary department, independent of the order returned by storage. */
export function primaryStaffDepartments(departments: readonly DepartmentAccess[]): Map<AccountUuid, Ref<Department>> {
  const result = new Map<AccountUuid, Ref<Department>>()
  const active = departments
    .filter((department) => !department.archived)
    .sort((a, b) => (a.createdOn ?? 0) - (b.createdOn ?? 0) || a._id.localeCompare(b._id))
  for (const department of active) {
    for (const person of [
      ...(department.administrators ?? []),
      ...(department.supervisors ?? []),
      ...(department.employees ?? []),
      ...(department.readers ?? [])
    ]) {
      if (!result.has(person)) result.set(person, department._id)
    }
  }
  return result
}
