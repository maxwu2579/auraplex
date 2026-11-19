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
import core, { TDoc, TSpace } from '@hcengineering/model-core'
import hr, { TDepartment } from '@hcengineering/model-hr'
import workbench from '@hcengineering/model-workbench'
import departments, {
  departmentsId,
  type DepartmentAccess,
  type AuditEvent,
  type AuditKind,
  type Order,
  type ModuleSettings,
  type DepartmentAutoMembers,
  type ModuleGrant,
  type OrderAction,
  type TrackingSettings,
  type OrderActionKind,
  type OrderFlow
} from '@hcengineering/departments'

export const DOMAIN_ORDERS = 'orders' as Domain
/** Tracking records live in their own table so their volume never slows the rest down. */
export const DOMAIN_AUDIT = 'audit' as Domain

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
  @Hidden() contactVisibility?: DepartmentAccess['contactVisibility']
  @Hidden() modules?: string[]
  @Hidden() autoJoin?: DepartmentAccess['autoJoin']
  @Hidden() moduleAccess?: DepartmentAccess['moduleAccess']
  @Hidden() orderAssignee?: DepartmentAccess['orderAssignee']
  @Prop(TypeBoolean(), departments.string.SupervisorsSeeTracking) supervisorsSeeTracking?: boolean
  @Prop(TypeBoolean(), departments.string.EmployeesSeeTracking) employeesSeeTracking?: boolean
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
  @Hidden() position?: number
  @Hidden() stageOrder?: string[]
  @Hidden() assignee?: OrderAction['assignee']
  @Hidden() step?: number
  @Hidden() target?: string
  @Hidden() name?: string
  @Hidden() department?: OrderAction['department']
  @Hidden() auto?: boolean
  @Prop(TypeString(), departments.string.Note) reason?: string
}

@Model(departments.class.AuditEvent, core.class.Doc, DOMAIN_AUDIT)
@UX(departments.string.AuditEvent, hr.icon.Department, undefined, 'label')
export class TAuditEvent extends TDoc implements AuditEvent {
  @Prop(TypeString(), departments.string.OrderActionLabel) kind!: AuditKind
  @Prop(TypeAccountUuid(), departments.string.Member) actor!: AuditEvent['actor']
  @Prop(TypeString(), departments.string.Note) label!: string
  @Hidden() objectId?: string
  @Hidden() objectClass?: string
  @Hidden() objectSpace?: string
  @Hidden() count!: number
  @Hidden() firstOn!: number
  @Hidden() lastOn!: number
}

@Model(departments.class.TrackingSettings, core.class.Doc, DOMAIN_AUDIT)
export class TTrackingSettings extends TDoc implements TrackingSettings {
  @Hidden() viewRetentionDays!: number
  @Hidden() alertCount!: number
  @Hidden() alertMinutes!: number
  @Hidden() lastCleanup?: number
}

const DOMAIN_MODULE_ACCESS = 'department_module_access' as Domain

@Model(departments.class.ModuleSettings, core.class.Doc, DOMAIN_MODULE_ACCESS)
export class TModuleSettings extends TDoc implements ModuleSettings {
  @Hidden() companyDefaults?: ModuleSettings['companyDefaults']
  @Hidden() enabled!: boolean
}

@Model(departments.class.ModuleGrant, core.class.Doc, DOMAIN_MODULE_ACCESS)
export class TModuleGrant extends TDoc implements ModuleGrant {
  @Hidden() person!: ModuleGrant['person']
  @Hidden() extra!: ModuleGrant['extra']
  @Hidden() blocked!: string[]
}

@Mixin(departments.mixin.DepartmentAutoMembers, core.class.Space)
class TDepartmentAutoMembers extends TSpace implements DepartmentAutoMembers {
  @Hidden() departmentAdded!: DepartmentAutoMembers['departmentAdded']
}

export function createModel (builder: Builder): void {
  builder.createModel(TDepartmentAccess, TDepartmentAutoMembers, TOrderFlow, TOrder, TOrderAction, TAuditEvent, TTrackingSettings, TModuleSettings, TModuleGrant)
  builder.createDoc(workbench.class.Application, core.space.Model, {
    label: departments.string.Tracking,
    icon: hr.icon.Department,
    alias: 'tracking',
    hidden: false,
    navigatorModel: {
      specials: [
        { id: 'log', label: departments.string.ActivityLog, icon: hr.icon.Department, component: departments.component.ActivityLog },
        { id: 'workload', label: departments.string.Workload, icon: hr.icon.Department, component: departments.component.Workload },
        { id: 'settings', label: departments.string.TrackingSettings, icon: hr.icon.Department, component: departments.component.TrackingSettingsPage }
      ],
      spaces: []
    }
  }, departments.app.Tracking)
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
