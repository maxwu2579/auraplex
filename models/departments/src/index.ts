// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import {
  ArrOf,
  Mixin,
  Prop,
  TypeAccountUuid,
  TypeBoolean,
  TypeRef,
  TypeString,
  type Builder
} from '@hcengineering/model'
import core from '@hcengineering/model-core'
import hr, { TDepartment } from '@hcengineering/model-hr'
import workbench from '@hcengineering/model-workbench'
import departments, { departmentsId, type DepartmentAccess } from '@hcengineering/departments'

export { departmentsId }
export default departments

@Mixin(departments.mixin.DepartmentAccess, hr.class.Department)
export class TDepartmentAccess extends TDepartment implements DepartmentAccess {
  @Prop(ArrOf(TypeAccountUuid()), departments.string.Administrators) administrators!: DepartmentAccess['administrators']
  @Prop(ArrOf(TypeAccountUuid()), departments.string.Supervisors) supervisors!: DepartmentAccess['supervisors']
  @Prop(ArrOf(TypeAccountUuid()), departments.string.Employees) employees!: DepartmentAccess['employees']
  @Prop(ArrOf(TypeAccountUuid()), departments.string.Readers) readers!: DepartmentAccess['readers']
  @Prop(ArrOf(TypeString()), departments.string.AdminPermissions)
    adminPermissions!: DepartmentAccess['adminPermissions']

  @Prop(ArrOf(TypeString()), departments.string.SupervisorPermissions)
    supervisorPermissions!: DepartmentAccess['supervisorPermissions']

  @Prop(ArrOf(TypeString()), departments.string.EmployeePermissions)
    employeePermissions!: DepartmentAccess['employeePermissions']

  @Prop(ArrOf(TypeString()), departments.string.ReaderPermissions)
    readerPermissions!: DepartmentAccess['readerPermissions']

  @Prop(TypeRef(core.class.Space), departments.string.ProjectSpace) projectSpace?: DepartmentAccess['projectSpace']
  @Prop(TypeRef(core.class.Space), departments.string.DocumentSpace) documentSpace?: DepartmentAccess['documentSpace']
  @Prop(TypeRef(core.class.Space), departments.string.DriveSpace) driveSpace?: DepartmentAccess['driveSpace']
  @Prop(TypeBoolean(), departments.string.Archived) archived!: boolean
}

export function createModel (builder: Builder): void {
  builder.createModel(TDepartmentAccess)
  builder.createDoc(workbench.class.Application, core.space.Model, {
    label: departments.string.Departments,
    icon: hr.icon.Department,
    alias: departmentsId,
    hidden: false,
    navigatorModel: {
      specials: [{ id: 'directory', label: departments.string.Departments, icon: hr.icon.Department, component: departments.component.Directory }],
      spaces: []
    }
  }, departments.app.Departments)
}
