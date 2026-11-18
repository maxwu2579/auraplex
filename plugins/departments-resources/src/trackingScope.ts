// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid } from '@hcengineering/core'
import type { DepartmentAccess } from '@hcengineering/departments'

/**
 * Whose tracking a person may see: super admins see every department; a department admin sees
 * their own; supervisors only when a super admin allowed it; staff only when their admin allowed it.
 */
export function visibleDepartments (
  all: DepartmentAccess[],
  me: AccountUuid,
  owner: boolean
): DepartmentAccess[] {
  return all.filter(
    (d) =>
      !d.archived &&
      (owner ||
        d.administrators.includes(me) ||
        (d.supervisorsSeeTracking === true && d.supervisors.includes(me)) ||
        (d.employeesSeeTracking === true && d.employees.includes(me)))
  )
}

/** People who work in these departments (read-only guests from other departments are not theirs). */
export function peopleOf (depts: DepartmentAccess[]): Set<AccountUuid> {
  return new Set(depts.flatMap((d) => [...d.administrators, ...d.supervisors, ...d.employees]))
}

export function dayStart (value: string): number {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

export function dateInput (time: number): string {
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
