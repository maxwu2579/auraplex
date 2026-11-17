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
import departments, { departmentsId, type DepartmentAccess } from '@hcengineering/departments'

export { departmentsId }
export default departments

@Mixin(departments.mixin.DepartmentAccess, hr.class.Department)
export class TDepartmentAccess extends TDepartment implements DepartmentAccess {
  @Prop(ArrOf(TypeAccountUuid()), core.string.Name) administrators!: DepartmentAccess['administrators']
  @Prop(ArrOf(TypeAccountUuid()), core.string.Name) supervisors!: DepartmentAccess['supervisors']
  @Prop(ArrOf(TypeAccountUuid()), core.string.Name) employees!: DepartmentAccess['employees']
  @Prop(ArrOf(TypeAccountUuid()), core.string.Name) readers!: DepartmentAccess['readers']
  @Prop(ArrOf(TypeString()), core.string.Name) adminPermissions!: DepartmentAccess['adminPermissions']
  @Prop(ArrOf(TypeString()), core.string.Name) supervisorPermissions!: DepartmentAccess['supervisorPermissions']
  @Prop(ArrOf(TypeString()), core.string.Name) employeePermissions!: DepartmentAccess['employeePermissions']
  @Prop(ArrOf(TypeString()), core.string.Name) readerPermissions!: DepartmentAccess['readerPermissions']
  @Prop(TypeRef(core.class.Space), core.string.Name) projectSpace?: DepartmentAccess['projectSpace']
  @Prop(TypeRef(core.class.Space), core.string.Name) documentSpace?: DepartmentAccess['documentSpace']
  @Prop(TypeRef(core.class.Space), core.string.Name) driveSpace?: DepartmentAccess['driveSpace']
  @Prop(TypeBoolean(), core.string.Name) archived!: boolean
}

export function createModel (builder: Builder): void {
  builder.createModel(TDepartmentAccess)
}
