//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import contact, { Employee } from '@hcengineering/contact'
import { AccountUuid, Class, Doc, Mixin, Ref } from '@hcengineering/core'
import { Execution } from '@hcengineering/process'
import { ProcessControl } from '@hcengineering/server-process'

// Ids of the Auraplex department data (kept as strings so this package does not depend on it).
const departmentClass = 'hr:class:Department' as Ref<Class<Doc>>
const departmentAccess = 'departments:mixin:DepartmentAccess' as Ref<Mixin<Doc>>

export interface DepartmentRoles {
  archived?: boolean
  administrators?: AccountUuid[]
  supervisors?: AccountUuid[]
  employees?: AccountUuid[]
  readers?: AccountUuid[]
}

/**
 * Who approves for this person: in each of their departments, an employee (or reader)
 * goes to the first supervisor, falling back to the first admin; a supervisor goes to
 * the first admin; an admin needs nobody from that department. One person per department,
 * because an approval request waits for every approver.
 */
export function pickDepartmentApprovers (initiator: AccountUuid, departments: DepartmentRoles[]): AccountUuid[] {
  const result = new Set<AccountUuid>()
  for (const dep of departments) {
    if (dep.archived === true) continue
    const admins = (dep.administrators ?? []).filter((it) => it !== initiator)
    const supervisors = (dep.supervisors ?? []).filter((it) => it !== initiator)
    let approver: AccountUuid | undefined
    if (dep.administrators?.includes(initiator) === true) {
      approver = undefined
    } else if (dep.supervisors?.includes(initiator) === true) {
      approver = admins[0]
    } else if (dep.employees?.includes(initiator) === true || dep.readers?.includes(initiator) === true) {
      approver = supervisors[0] ?? admins[0]
    }
    if (approver !== undefined) result.add(approver)
  }
  return [...result]
}

export async function InitiatorDepartmentSupervisor (
  value: null,
  props: Record<string, any>,
  control: ProcessControl,
  execution: Execution
): Promise<Ref<Employee>[]> {
  const socialId = await control.client.findOne(contact.class.SocialIdentity, {
    _id: (execution.createdBy ?? execution.modifiedBy) as any
  })
  if (socialId === undefined) return []
  const person = await control.client.findOne(contact.class.Person, { _id: socialId.attachedTo })
  const initiator = person?.personUuid as AccountUuid | undefined
  if (initiator === undefined) return []

  const hierarchy = control.client.getHierarchy()
  if (!hierarchy.hasClass(departmentClass) || !hierarchy.hasClass(departmentAccess)) return []
  const docs = await control.client.findAll(departmentClass, {})
  const roles = docs
    .filter((doc) => hierarchy.hasMixin(doc, departmentAccess))
    .map((doc) => hierarchy.as(doc, departmentAccess) as unknown as DepartmentRoles)

  const accounts = pickDepartmentApprovers(initiator, roles)
  if (accounts.length === 0) return []
  const employees = await control.client.findAll(contact.mixin.Employee, { personUuid: { $in: accounts } })
  // Keep the department order.
  return accounts
    .map((acc) => employees.find((it) => it.personUuid === acc)?._id)
    .filter((it): it is Ref<Employee> => it !== undefined)
}
