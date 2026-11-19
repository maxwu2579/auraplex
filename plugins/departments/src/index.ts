// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { CompanyModuleDefaults, AccountUuid, Class, Client, Doc, Mixin, ModuleAccess, ModuleExtra, Ref, Space } from '@hcengineering/core'
import type { Department } from '@hcengineering/hr'
import { plugin, type IntlString, type Plugin, type Resource } from '@hcengineering/platform'
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
  contactVisibility?: 'company' | 'department' | 'admins'
  modules?: string[]
  autoJoin?: Record<string, Ref<Space>[]>
  moduleAccess?: ModuleAccess
  /** Who gets a new order stage of this department when nobody was picked (must be a member). */
  orderAssignee?: AccountUuid
  /** Tracking access: supervisors (set by super admins) and staff (set by the department admin). */
  supervisorsSeeTracking?: boolean
  employeesSeeTracking?: boolean
}

export type OrderApproval = { by: 'deptAdmins' } | { by: 'person', person: AccountUuid }

/** One stage of the order flow template, e.g. 设计 handled by the design department. */
export interface OrderFlowStage {
  id: string
  name: string
  department?: Ref<Department>
  limitDays?: number
  approval?: OrderApproval
  steps: string[]
}

/** The order flow every new order copies. Changes only affect orders created afterwards. */
export interface OrderFlow extends Doc {
  stages: OrderFlowStage[]
}

export type OrderStageStatus = 'waiting' | 'active' | 'done' | 'approval'
export interface OrderStage {
  id: string
  name: string
  department?: Ref<Department>
  status: OrderStageStatus
  assignee?: AccountUuid
  steps: Array<{ name: string, done: boolean }>
  limitDays?: number
  approval?: OrderApproval
  startedOn?: number
  doneOn?: number
  todo?: Ref<Doc>
  remindedOn?: number
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
  /** pending: created but not started yet (started by hand or by scanning its QR code). */
  state: 'pending' | 'active' | 'done'
  /** Linked places, created on first use: chat channel, tracker component, document, drive folder. */
  channel?: Ref<Doc>
  component?: Ref<Doc>
  document?: Ref<Doc>
  folder?: Ref<Doc>
  /** The tracker project / teamspace / drive that holds the linked component, document and folder. */
  linkSpaces?: Record<string, Ref<Space>>
}

export type OrderActionKind = 'assign' | 'step' | 'complete' | 'escalate' | 'return' | 'insert' | 'reorder' | 'approve' | 'reject' | 'start' | 'scan'

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
  position?: number
  stageOrder?: string[]
  /** insert: name and department of the stage added right after the current one. */
  name?: string
  department?: Ref<Department>
  /** Written by the system for an automatic assignment; only kept in the history. */
  auto?: boolean
}

export const defaultOrderStages: OrderFlowStage[] = [
  { id: 'sales', name: '销售', steps: [] },
  { id: 'design', name: '设计', steps: [] },
  { id: 'production', name: '生产', steps: [] },
  { id: 'engineering', name: '工程', steps: [] },
  { id: 'training', name: '去客户工厂教', steps: [] }
]

export type AuditKind = 'login' | 'view' | 'export' | 'search' | 'alert' | 'whatsapp'

/**
 * Things Huly's change log does not keep: logins, pages opened, exports, and anomaly alerts.
 * Repeated opens of the same page by the same person within 30 minutes are one record with a count.
 */
export interface AuditEvent extends Doc {
  kind: AuditKind
  actor: AccountUuid
  label: string
  objectId?: string
  objectClass?: string
  objectSpace?: string
  count: number
  firstOn: number
  lastOn: number
}

/** Super admin settings for tracking. */
export interface TrackingSettings extends Doc {
  viewRetentionDays: number
  alertCount: number
  alertMinutes: number
  lastCleanup?: number
}

export const defaultTrackingSettings = { viewRetentionDays: 365, alertCount: 100, alertMinutes: 60 }

export interface ModuleSettings extends Doc {
  companyDefaults?: CompanyModuleDefaults
  enabled: boolean
}
export interface ModuleGrant extends Doc {
  person: AccountUuid
  extra: ModuleExtra
  blocked: string[]
}

export interface DepartmentAutoMembers extends Space {
  departmentAdded: AccountUuid[]
}

export const departmentsId = 'departments' as Plugin
export default plugin(departmentsId, {
  mixin: {
    DepartmentAccess: '' as Ref<Mixin<DepartmentAccess>>,
    DepartmentAutoMembers: '' as Ref<Mixin<DepartmentAutoMembers>>
  },
  class: {
    ModuleSettings: '' as Ref<Class<ModuleSettings>>,
    ModuleGrant: '' as Ref<Class<ModuleGrant>>,
    Order: '' as Ref<Class<Order>>,
    OrderFlow: '' as Ref<Class<OrderFlow>>,
    OrderAction: '' as Ref<Class<OrderAction>>,
    AuditEvent: '' as Ref<Class<AuditEvent>>,
    TrackingSettings: '' as Ref<Class<TrackingSettings>>
  },
  ids: { ModuleSettings: '' as Ref<ModuleSettings>, OrderFlow: '' as Ref<OrderFlow>, TrackingSettings: '' as Ref<TrackingSettings> },
  app: { Departments: '' as Ref<Doc>, Orders: '' as Ref<Doc>, Tracking: '' as Ref<Doc> },
  component: {
    Directory: '' as AnyComponent,
    Orders: '' as AnyComponent,
    OrderFlowSettings: '' as AnyComponent,
    ActivityLog: '' as AnyComponent,
    Workload: '' as AnyComponent,
    TrackingSettingsPage: '' as AnyComponent,
    TodayActivity: '' as AnyComponent,
    OrderPanel: '' as AnyComponent
  },
  function: {
    OrderTitle: '' as Resource<(client: Client, ref: Ref<Doc>, doc?: Doc) => Promise<string>>
  },
  string: {
    TrackingPageSystem: '' as IntlString,
    TrackingPageLogin: '' as IntlString,
    TrackingPageOpen: '' as IntlString,
    TrackingPageExport: '' as IntlString,
    TrackingPageSearch: '' as IntlString,
    TrackingPageAlert: '' as IntlString,
    TrackingPageWhatsapp: '' as IntlString,
    TrackingPageOrderAction: '' as IntlString,
    TrackingPageComment: '' as IntlString,
    TrackingPageCreate: '' as IntlString,
    TrackingPageRemove: '' as IntlString,
    TrackingPageUpdate: '' as IntlString,
    TrackingPageLoadFailed: '' as IntlString,
    TrackingPageWhen: '' as IntlString,
    TrackingPageWho: '' as IntlString,
    TrackingPageAction: '' as IntlString,
    TrackingPageObject: '' as IntlString,
    TrackingPageChanges: '' as IntlString,
    TrackingPageActivity: '' as IntlString,
    TrackingPageNoAccess: '' as IntlString,
    TrackingPageDepartment: '' as IntlString,
    TrackingPageAll: '' as IntlString,
    TrackingPageAllVisible: '' as IntlString,
    TrackingPagePerson: '' as IntlString,
    TrackingPageFrom: '' as IntlString,
    TrackingPageTo: '' as IntlString,
    TrackingPageType: '' as IntlString,
    TrackingPageSearchPlaceholder: '' as IntlString,
    TrackingPageLoading: '' as IntlString,
    TrackingPageQuery: '' as IntlString,
    TrackingPageExportExcel: '' as IntlString,
    TrackingPageResultCount: '' as IntlString,
    TrackingPageLimitHint: '' as IntlString,
    TrackingPageRepeat: '' as IntlString,
    TrackingPageShortRepeat: '' as IntlString,
    TrackingPageExportActivity: '' as IntlString,
    TrackingPageWorkload: '' as IntlString,
    TrackingPageStagesDone: '' as IntlString,
    TrackingPageAverageDays: '' as IntlString,
    TrackingPageStagesOpen: '' as IntlString,
    TrackingPageTasksDone: '' as IntlString,
    TrackingPageOverdueTasks: '' as IntlString,
    TrackingPagePerPerson: '' as IntlString,
    TrackingPagePerDepartment: '' as IntlString,
    TrackingPageEachPerson: '' as IntlString,
    TrackingPageInProgress: '' as IntlString,
    TrackingPageWorkloadDenied: '' as IntlString,
    TrackingPageThisWeek: '' as IntlString,
    TrackingPageLastWeek: '' as IntlString,
    TrackingPageLastMonth: '' as IntlString,
    TrackingPageWorkloadHint: '' as IntlString,
    TrackingPageExportWorkload: '' as IntlString,
    TrackingPageTrackingSettings: '' as IntlString,
    TrackingPageOwnerOnly: '' as IntlString,
    TrackingPageRetentionDays: '' as IntlString,
    TrackingPageRetentionHint: '' as IntlString,
    TrackingPageMinutes: '' as IntlString,
    TrackingPageMaxViews: '' as IntlString,
    TrackingPageAlertHint: '' as IntlString,
    TrackingPageSettingsSaveError: '' as IntlString,
    TrackingPageSave: '' as IntlString,
    TrackingPageSaving: '' as IntlString,
    TrackingPageSettingsSaved: '' as IntlString,
    TrackingPageToday: '' as IntlString,
    TrackingPageTodayTitle: '' as IntlString,
    TrackingPageTodayOnly: '' as IntlString,
    TrackingPageClose: '' as IntlString,
    TrackingPageNoToday: '' as IntlString,
    TrackingPageMoreRecords: '' as IntlString,
    TrackingPageOpenTracking: '' as IntlString,
    TrackingPageTodayBadge: '' as IntlString,

    DirectoryAdministrator: '' as IntlString,
    DirectorySupervisor: '' as IntlString,
    DirectoryEmployee: '' as IntlString,
    DirectoryGuest: '' as IntlString,
    DirectoryConfiguredSpace: '' as IntlString,
    DirectoryAll: '' as IntlString,
    DirectoryEnabledModules: '' as IntlString,
    DirectoryDisabledModules: '' as IntlString,
    DirectoryNone: '' as IntlString,
    DirectoryEnabled: '' as IntlString,
    DirectoryEdit: '' as IntlString,
    DirectoryCanEdit: '' as IntlString,
    DirectoryView: '' as IntlString,
    DirectoryControlModules: '' as IntlString,
    DirectoryControlHint: '' as IntlString,
    DirectoryCompanyDefaults: '' as IntlString,
    DirectoryCompanyHint: '' as IntlString,
    DirectoryGuestLink: '' as IntlString,
    DirectoryModule: '' as IntlString,
    DirectorySaveDefaults: '' as IntlString,
    DirectoryDefaultsSaved: '' as IntlString,
    DirectoryMembers: '' as IntlString,
    DirectoryModuleAccess: '' as IntlString,
    DirectorySettings: '' as IntlString,
    DirectoryAddMembers: '' as IntlString,
    DirectoryPrivate: '' as IntlString,
    DirectoryRole: '' as IntlString,
    DirectoryExceptions: '' as IntlString,
    DirectoryMessage: '' as IntlString,
    DirectoryRemove: '' as IntlString,
    DirectoryExtra: '' as IntlString,
    DirectoryNoExtra: '' as IntlString,
    DirectoryBlocked: '' as IntlString,
    DirectorySaveExceptions: '' as IntlString,
    DirectoryCancel: '' as IntlString,
    DirectoryFilter: '' as IntlString,
    DirectorySpacePermissions: '' as IntlString,
    DirectoryAutoJoin: '' as IntlString,
    DirectoryContactVisibility: '' as IntlString,
    DirectoryCompany: '' as IntlString,
    DirectoryDepartment: '' as IntlString,
    DirectoryAdmins: '' as IntlString,
    DirectoryContactHint: '' as IntlString,
    DirectoryDefaultOwner: '' as IntlString,
    DirectoryAutomaticOwner: '' as IntlString,
    DirectoryArchived: '' as IntlString,
    DirectoryCount: '' as IntlString,
    DirectoryAdminName: '' as IntlString,
    DirectoryPersonExceptions: '' as IntlString,

    FlowDone: '' as IntlString,
    FlowActive: '' as IntlString,
    FlowWaiting: '' as IntlString,
    FlowApproval: '' as IntlString,
    FlowAssignee: '' as IntlString,
    FlowElapsed: '' as IntlString,
    FlowNeedsApproval: '' as IntlString,
    FlowLimit: '' as IntlString,
    FlowNewStage: '' as IntlString,
    FlowStageNameRequired: '' as IntlString,
    FlowSaved: '' as IntlString,
    FlowSaveFailed: '' as IntlString,
    FlowOwnerHint: '' as IntlString,
    FlowAdminHint: '' as IntlString,
    FlowNewOrdersOnly: '' as IntlString,
    FlowDeleteStage: '' as IntlString,
    FlowTimeLimit: '' as IntlString,
    FlowApprover: '' as IntlString,
    FlowNoApproval: '' as IntlString,
    FlowDepartmentAdmins: '' as IntlString,
    FlowStep: '' as IntlString,
    FlowAddStep: '' as IntlString,
    FlowAddStage: '' as IntlString,
    FlowSaving: '' as IntlString,

    OrderUnassignedDepartment: '' as IntlString,
    OrderUnderOneDay: '' as IntlString,
    OrderAssign: '' as IntlString,
    OrderCheckStep: '' as IntlString,
    OrderCompleteStage: '' as IntlString,
    OrderEscalate: '' as IntlString,
    OrderReturn: '' as IntlString,
    OrderInsert: '' as IntlString,
    OrderReorder: '' as IntlString,
    OrderApprove: '' as IntlString,
    OrderReject: '' as IntlString,
    OrderCreateDenied: '' as IntlString,
    OrderSaved: '' as IntlString,
    OrderEditDenied: '' as IntlString,
    OrderSubmitted: '' as IntlString,
    OrderActionDone: '' as IntlString,
    OrderActionDenied: '' as IntlString,
    OrderWaitingOnMe: '' as IntlString,
    OrderOrderTitle: '' as IntlString,
    OrderCustomer: '' as IntlString,
    OrderOptionalNote: '' as IntlString,
    OrderCompleted: '' as IntlString,
    OrderProgress: '' as IntlString,
    OrderAwaitingApproval: '' as IntlString,
    OrderInProgress: '' as IntlString,
    OrderReturned: '' as IntlString,
    OrderFinishAdjustment: '' as IntlString,
    OrderAdjustFlow: '' as IntlString,
    OrderUnassigned: '' as IntlString,
    OrderRejectionReason: '' as IntlString,
    OrderSubmitApproval: '' as IntlString,
    OrderHandOff: '' as IntlString,
    OrderExplainIssue: '' as IntlString,
    OrderReturnTo: '' as IntlString,
    OrderKeepAssignee: '' as IntlString,
    OrderAutomatic: '' as IntlString,
    OrderApprovalSubmitted: '' as IntlString,
    OrderCollapse: '' as IntlString,
    OrderShowAll: '' as IntlString,
    OrderStageProgress: '' as IntlString,
    OrderAllStagesDone: '' as IntlString,
    OrderDays: '' as IntlString,
    OrderOverdueDays: '' as IntlString,
    OrderRemainingDays: '' as IntlString,
    OrderElapsed: '' as IntlString,
    OrderOrderInfo: '' as IntlString,

    OrderPage1: '' as IntlString,
    OrderPage2: '' as IntlString,
    OrderPage3: '' as IntlString,
    OrderPage4: '' as IntlString,
    OrderPage5: '' as IntlString,
    OrderPage6: '' as IntlString,
    OrderPage7: '' as IntlString,
    OrderPage8: '' as IntlString,
    OrderPage9: '' as IntlString,
    OrderPage10: '' as IntlString,
    OrderPage11: '' as IntlString,
    OrderPage12: '' as IntlString,
    OrderPage13: '' as IntlString,
    OrderPage14: '' as IntlString,
    OrderPage15: '' as IntlString,
    OrderPage16: '' as IntlString,
    OrderPage17: '' as IntlString,
    OrderPage18: '' as IntlString,
    OrderPage19: '' as IntlString,
    OrderPage20: '' as IntlString,
    OrderPage21: '' as IntlString,
    OrderPage22: '' as IntlString,
    OrderPage23: '' as IntlString,
    OrderPage24: '' as IntlString,
    OrderPage25: '' as IntlString,
    OrderPage26: '' as IntlString,
    OrderPage27: '' as IntlString,
    OrderPage28: '' as IntlString,
    OrderPage29: '' as IntlString,

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
    OrderFinished: '' as IntlString,
    Tracking: '' as IntlString,
    ActivityLog: '' as IntlString,
    Workload: '' as IntlString,
    TrackingSettings: '' as IntlString,
    AuditEvent: '' as IntlString,
    TooManyViews: '' as IntlString,
    SupervisorsSeeTracking: '' as IntlString,
    EmployeesSeeTracking: '' as IntlString
  }
})
