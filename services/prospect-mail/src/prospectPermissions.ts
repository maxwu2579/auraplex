// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import core, {
  AccountRole, companyModuleDefault, effectiveDepartmentModules, type AccountUuid, type TxOperations
} from '@hcengineering/core'
import departments, { type DepartmentAccess } from '@hcengineering/departments'
import hr from '@hcengineering/hr'

export async function prospectDepartments (client: TxOperations): Promise<DepartmentAccess[]> {
  const hierarchy = client.getHierarchy()
  return (await client.findAll(hr.class.Department, {}))
    .filter((doc) => hierarchy.hasMixin(doc, departments.mixin.DepartmentAccess))
    .map((doc) => hierarchy.as(doc, departments.mixin.DepartmentAccess))
}

export async function canManageAutomation (client: TxOperations, person: AccountUuid, role: AccountRole): Promise<boolean> {
  if (role === AccountRole.Owner || !client.getHierarchy().hasClass(departments.class.ModuleSettings)) return true
  const settings = await client.findOne(departments.class.ModuleSettings, { _id: departments.ids.ModuleSettings })
  if (settings?.enabled !== true) return true
  const [teams, grant] = await Promise.all([
    prospectDepartments(client),
    client.findOne(departments.class.ModuleGrant, { person })
  ])
  return effectiveDepartmentModules(person, false, true, teams.map((team) => ({
    modules: team.modules,
    moduleAccess: team.moduleAccess,
    archived: team.archived,
    members: {
      admin: team.administrators ?? [], supervisor: team.supervisors ?? [],
      employee: team.employees ?? [], reader: team.readers ?? []
    }
  })), grant, companyModuleDefault(settings.companyDefaults, role))('prospects') === 'edit'
}

export function prospectLeads (teams: DepartmentAccess[], ownerFallback: AccountUuid[] = []): AccountUuid[] {
  const responsible = teams.filter((team) => !team.archived && team.modules?.includes('prospects'))
  return [...new Set(responsible.length === 0 ? ownerFallback
    : responsible.flatMap((team) => [...(team.administrators ?? []), ...(team.supervisors ?? [])]))]
}
