// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import contact from '@hcengineering/contact'
import { toIdMap, type AccountUuid, type Ref, type Tx } from '@hcengineering/core'
import departments, { primaryStaffDepartments } from '@hcengineering/departments'
import hr, { type Department, type Staff } from '@hcengineering/hr'
import type { TriggerControl } from '@hcengineering/server-core'

export async function syncStaffDepartments (
  control: TriggerControl,
  changed: ReadonlySet<Ref<Department>>
): Promise<Tx[]> {
  const managed = (await control.findAll(control.ctx, hr.class.Department, {})).flatMap(
    (department) => control.hierarchy.asIf(department, departments.mixin.DepartmentAccess) ?? []
  )
  const removed = [...changed].filter((id) => {
    const previous = control.removedMap.get(id)
    return previous !== undefined && control.hierarchy.hasMixin(previous, departments.mixin.DepartmentAccess)
  })
  const changedDepartments = managed.filter((department) => changed.has(department._id))
  const changedIds = [...removed, ...changedDepartments.map((department) => department._id)]
  if (changedIds.length === 0) return []
  const changedPeople = new Set<AccountUuid>(
    changedDepartments.flatMap((department) => [
      ...(department.administrators ?? []),
      ...(department.supervisors ?? []),
      ...(department.employees ?? []),
      ...(department.readers ?? [])
    ])
  )
  const primary = primaryStaffDepartments(managed)
  const [added, assigned] = await Promise.all([
    control.findAll(control.ctx, contact.mixin.Employee, { personUuid: { $in: [...changedPeople] } }),
    control.findAll(control.ctx, hr.mixin.Staff, { department: { $in: changedIds } })
  ])
  const employees = new Map([...added, ...assigned].map((employee) => [employee._id, employee])).values()
  const result: Tx[] = []
  for (const employee of employees) {
    const before = control.hierarchy.asIf(employee, hr.mixin.Staff)?.department ?? undefined
    const after = employee.personUuid === undefined ? undefined : primary.get(employee.personUuid)
    if (before !== after) {
      result.push(
        control.txFactory.createTxMixin(employee._id, employee._class, employee.space, hr.mixin.Staff, {
          department: after ?? null
        })
      )
    }
  }
  return result
}

/** The HR calendar reads the department's member list, including inherited members. */
export async function syncDepartmentMembers (control: TriggerControl, changed: ReadonlySet<Ref<Staff>>): Promise<Tx[]> {
  if (changed.size === 0) return []
  const [staff, departmentList] = await Promise.all([
    control.findAll(control.ctx, hr.mixin.Staff, { _id: { $in: [...changed] } }),
    control.findAll(control.ctx, hr.class.Department, {})
  ])
  const departmentById = toIdMap(departmentList)
  const result: Tx[] = []
  for (const employee of staff) {
    // Role changes generate derived transactions. Read the current projection instead of transaction history.
    const desired = new Set<Ref<Department>>()
    let department = employee.department
    while (department != null && !desired.has(department)) {
      desired.add(department)
      department = departmentById.get(department)?.parent ?? null
    }
    for (const entry of departmentList) {
      const hasMember = entry.members.includes(employee._id)
      const needsMember = desired.has(entry._id)
      if (hasMember === needsMember) continue
      result.push(
        control.txFactory.createTxUpdateDoc(
          hr.class.Department,
          entry.space,
          entry._id,
          needsMember ? { $push: { members: employee._id } } : { $pull: { members: employee._id } }
        )
      )
    }
  }
  return result
}
