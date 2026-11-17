// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid, Mixin, Ref, Space } from '@hcengineering/core'
import type { Department } from '@hcengineering/hr'
import { plugin, type Plugin } from '@hcengineering/platform'

export type DepartmentPermission = 'create' | 'update' | 'delete' | 'comment' | 'invite' | 'manageMembers'
export interface DepartmentAccess extends Department {
  administrators: AccountUuid[]
  supervisors: AccountUuid[]
  employees: AccountUuid[]
  readers: AccountUuid[]
  adminPermissions: DepartmentPermission[]
  supervisorPermissions: DepartmentPermission[]
  employeePermissions: DepartmentPermission[]
  readerPermissions: DepartmentPermission[]
  projectSpace?: Ref<Space>
  documentSpace?: Ref<Space>
  driveSpace?: Ref<Space>
  archived: boolean
}

export const departmentsId = 'departments' as Plugin
export default plugin(departmentsId, {
  mixin: { DepartmentAccess: '' as Ref<Mixin<DepartmentAccess>> }
})
