// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { Domain } from '@hcengineering/core'
import {
  ArrOf,
  Hidden,
  Mixin,
  Model,
  Prop,
  TypeAccountUuid,
  TypeBoolean,
  TypeNumber,
  TypeRef,
  TypeString,
  UX,
  type Builder
} from '@hcengineering/model'
import core, { TDoc } from '@hcengineering/model-core'
import hr, { TDepartment } from '@hcengineering/model-hr'
import workbench from '@hcengineering/model-workbench'
import departments, {
  departmentsId,
  type DepartmentAccess,
  type Order,
  type OrderAction,
  type OrderActionKind,
  type OrderFlow
} from '@hcengineering/departments'

export const DOMAIN_ORDERS = 'orders' as Domain

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

@Model(departments.class.OrderFlow, core.class.Doc, DOMAIN_ORDERS)
export class TOrderFlow extends TDoc implements OrderFlow {
  @Hidden() stages!: OrderFlow['stages']
}

@Model(departments.class.Order, core.class.Doc, DOMAIN_ORDERS)
@UX(departments.string.Order, hr.icon.Department, undefined, 'number', undefined, departments.string.Orders)
export class TOrder extends TDoc implements Order {
  @Prop(TypeString(), departments.string.OrderNumber) number!: string
  @Prop(TypeString(), departments.string.OrderTitle) title!: string
  @Prop(TypeString(), departments.string.Customer) customer!: string
  @Prop(TypeString(), departments.string.Note) note!: string
  @Prop(TypeAccountUuid(), departments.string.SalesOwner) salesOwner!: Order['salesOwner']
  @Hidden() stages!: Order['stages']
  @Prop(TypeNumber(), departments.string.CurrentStage) current!: number
  @Prop(TypeString(), departments.string.OrderState) state!: Order['state']
}

@Model(departments.class.OrderAction, core.class.Doc, DOMAIN_ORDERS)
export class TOrderAction extends TDoc implements OrderAction {
  @Prop(TypeRef(departments.class.Order), departments.string.Order) order!: OrderAction['order']
  @Prop(TypeString(), departments.string.OrderActionLabel) kind!: OrderActionKind
  @Hidden() stage!: string
  @Prop(TypeAccountUuid(), departments.string.Member) actor!: OrderAction['actor']
  @Hidden() assignee?: OrderAction['assignee']
  @Hidden() step?: number
  @Hidden() target?: string
  @Prop(TypeString(), departments.string.Note) reason?: string
}

export function createModel (builder: Builder): void {
  builder.createModel(TDepartmentAccess, TOrderFlow, TOrder, TOrderAction)
  builder.createDoc(workbench.class.Application, core.space.Model, {
    label: departments.string.Orders,
    icon: hr.icon.Department,
    alias: 'orders',
    hidden: false,
    navigatorModel: {
      specials: [
        { id: 'orders', label: departments.string.Orders, icon: hr.icon.Department, component: departments.component.Orders },
        { id: 'flow', label: departments.string.OrderFlow, icon: hr.icon.Department, component: departments.component.OrderFlowSettings }
      ],
      spaces: []
    }
  }, departments.app.Orders)
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
