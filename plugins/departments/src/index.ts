// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid, Doc, Mixin, Ref, Space } from '@hcengineering/core'
import type { Department } from '@hcengineering/hr'
import { plugin, type IntlString, type Plugin } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'

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
  mixin: { DepartmentAccess: '' as Ref<Mixin<DepartmentAccess>> },
  app: { Departments: '' as Ref<Doc> },
  component: { Directory: '' as AnyComponent },
  string: {
    Departments: '' as IntlString,
    CreateDepartment: '' as IntlString,
    DepartmentName: '' as IntlString,
    ChooseAdministrator: '' as IntlString,
    Create: '' as IntlString,
    Save: '' as IntlString,
    Cancel: '' as IntlString,
    Member: '' as IntlString,
    CreatePermission: '' as IntlString,
    UpdatePermission: '' as IntlString,
    DeletePermission: '' as IntlString,
    CommentPermission: '' as IntlString,
    InvitePermission: '' as IntlString,
    ManageMembersPermission: '' as IntlString,
    NoPermission: '' as IntlString,
    Saved: '' as IntlString,
    SaveError: '' as IntlString,
    Processing: '' as IntlString,
    InviteHelp: '' as IntlString,
    Administrators: '' as IntlString,
    Supervisors: '' as IntlString,
    Employees: '' as IntlString,
    Readers: '' as IntlString,
    AdminPermissions: '' as IntlString,
    SupervisorPermissions: '' as IntlString,
    EmployeePermissions: '' as IntlString,
    ReaderPermissions: '' as IntlString,
    ProjectSpace: '' as IntlString,
    DocumentSpace: '' as IntlString,
    DriveSpace: '' as IntlString,
    Archived: '' as IntlString
  }
})
