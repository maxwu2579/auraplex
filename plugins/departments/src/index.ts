// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid, Class, Doc, Mixin, Ref, Space } from '@hcengineering/core'
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

/** One stage of the order flow template, e.g. 设计 handled by the design department. */
export interface OrderFlowStage {
  id: string
  name: string
  department?: Ref<Department>
  steps: string[]
}

/** The order flow every new order copies. Changes only affect orders created afterwards. */
export interface OrderFlow extends Doc {
  stages: OrderFlowStage[]
}

export type OrderStageStatus = 'waiting' | 'active' | 'done'
export interface OrderStage {
  id: string
  name: string
  department?: Ref<Department>
  status: OrderStageStatus
  assignee?: AccountUuid
  steps: Array<{ name: string, done: boolean }>
  startedOn?: number
  doneOn?: number
}

/** A customer order moving through the stages. Only the system changes stages (via OrderAction). */
export interface Order extends Doc {
  number: string
  title: string
  customer: string
  note: string
  salesOwner: AccountUuid
  stages: OrderStage[]
  current: number
  state: 'active' | 'done'
}

export type OrderActionKind = 'assign' | 'step' | 'complete' | 'escalate' | 'return'

/** A request to move an order; checked by the server, applied by the system, kept as history. */
export interface OrderAction extends Doc {
  order: Ref<Order>
  kind: OrderActionKind
  stage: string
  actor: AccountUuid
  assignee?: AccountUuid
  step?: number
  target?: string
  reason?: string
}

export const defaultOrderStages: OrderFlowStage[] = [
  { id: 'sales', name: '销售', steps: [] },
  { id: 'design', name: '设计', steps: [] },
  { id: 'production', name: '生产', steps: [] },
  { id: 'engineering', name: '工程', steps: [] },
  { id: 'training', name: '去客户工厂教', steps: [] }
]

export const departmentsId = 'departments' as Plugin
export default plugin(departmentsId, {
  mixin: { DepartmentAccess: '' as Ref<Mixin<DepartmentAccess>> },
  class: {
    Order: '' as Ref<Class<Order>>,
    OrderFlow: '' as Ref<Class<OrderFlow>>,
    OrderAction: '' as Ref<Class<OrderAction>>
  },
  ids: { OrderFlow: '' as Ref<OrderFlow> },
  app: { Departments: '' as Ref<Doc>, Orders: '' as Ref<Doc> },
  component: {
    Directory: '' as AnyComponent,
    Orders: '' as AnyComponent,
    OrderFlowSettings: '' as AnyComponent
  },
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
    Archived: '' as IntlString,
    Orders: '' as IntlString,
    OrderFlow: '' as IntlString,
    Order: '' as IntlString,
    OrderNumber: '' as IntlString,
    OrderTitle: '' as IntlString,
    Customer: '' as IntlString,
    Note: '' as IntlString,
    SalesOwner: '' as IntlString,
    Stages: '' as IntlString,
    CurrentStage: '' as IntlString,
    OrderState: '' as IntlString,
    OrderActionLabel: '' as IntlString,
    OrderHandedOver: '' as IntlString,
    OrderEscalated: '' as IntlString,
    OrderReturned: '' as IntlString,
    OrderAssigned: '' as IntlString,
    OrderFinished: '' as IntlString
  }
})
