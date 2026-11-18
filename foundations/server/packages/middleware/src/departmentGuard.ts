// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import core, {
  TxProcessor,
  canChangeDepartmentModuleException,
  departmentModuleGrantClass,
  departmentModuleSettingsClass,
  departmentModuleSettingsId,
  effectiveDepartmentModules,
  toFindResult,
  moduleRoles,
  type ModuleAccess,
  type ModuleExtra,
  type DepartmentModuleException,
  type DocumentQuery,
  type FindOptions,
  type FindResult,
  type SearchQuery,
  type SearchOptions,
  type SearchResult,
  clone,
  type Class,
  type Doc,
  type MeasureContext,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  type TxApplyIf,
  type TxCUD,
  type TxCreateDoc,
  type TxMixin,
  type TxUpdateDoc
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import { classifyDepartmentAction } from './departmentAction'
import {
  canChangeDepartment,
  canChangeDepartmentOptions,
  departmentRoles,
  effectivePermissions,
  type DepartmentMembers,
  type DepartmentPermission,
  type DepartmentPolicy
} from './departmentPolicy'
import { canChangeFlow, canCreateOrder, canEditOrder, canOrderAction, type OrderLike, type RoleOf } from './orderPolicy'
import { isOwner, isSystem } from './utils'

// This package sits below the plugins, so their ids are spelled out here.
export const departmentClass = 'hr:class:Department' as Ref<Class<Doc>>
export const departmentAccessMixin = 'departments:mixin:DepartmentAccess' as Ref<Class<Doc>>
export const orderClass = 'departments:class:Order' as Ref<Class<Doc>>
export const orderActionClass = 'departments:class:OrderAction' as Ref<Class<Doc>>
export const orderFlowClass = 'departments:class:OrderFlow' as Ref<Class<Doc>>
export const auditEventClass = 'departments:class:AuditEvent' as Ref<Class<Doc>>
export const trackingSettingsClass = 'departments:class:TrackingSettings' as Ref<Class<Doc>>
const auditKinds = ['login', 'view', 'export', 'search']
const spaceFields = ['projectSpace', 'documentSpace', 'driveSpace'] as const
const memberFields = { admin: 'administrators', supervisor: 'supervisors', employee: 'employees', reader: 'readers' }
const policyFields = {
  admin: 'adminPermissions',
  supervisor: 'supervisorPermissions',
  employee: 'employeePermissions',
  reader: 'readerPermissions'
}

export interface DepartmentRecord {
  _id: Ref<Doc>
  members: DepartmentMembers
  policy: DepartmentPolicy
  spaces: Array<Ref<Space>>
  archived: boolean
  contactVisibility?: unknown
  modules?: unknown
  moduleAccess?: unknown
  supervisorsSeeTracking: boolean
  employeesSeeTracking: boolean
}

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((it): it is string => typeof it === 'string') : []

/** Read the DepartmentAccess mixin stored on an hr Department document. */
export function readDepartment (doc: Doc): DepartmentRecord | undefined {
  const access = (doc as unknown as Record<string, unknown>)[departmentAccessMixin] as
    | Record<string, unknown>
    | undefined
  if (access === undefined) return undefined
  const members = {} as unknown as DepartmentMembers
  const policy = {} as unknown as DepartmentPolicy
  for (const role of departmentRoles) {
    members[role] = list(access[memberFields[role]])
    policy[role] = list(access[policyFields[role]]) as DepartmentPermission[]
  }
  const spaces = spaceFields.map((field) => access[field]).filter((it): it is Ref<Space> => typeof it === 'string')
  return {
    _id: doc._id,
    members,
    policy,
    spaces,
    archived: access.archived === true,
    contactVisibility: access.contactVisibility,
    modules: access.modules,
    moduleAccess: access.moduleAccess,
    supervisorsSeeTracking: access.supervisorsSeeTracking === true,
    employeesSeeTracking: access.employeesSeeTracking === true
  }
}

/**
 * Space documents of a department are maintained by the system (members, roles, name).
 * Members may only bump the issue counter, which creating a task needs.
 */
export function isCounterUpdate (tx: TxCUD<Doc>): boolean {
  if (tx._class !== core.class.TxUpdateDoc) return false
  const ops = (tx as TxUpdateDoc<Doc>).operations as Record<string, unknown>
  const keys = Object.keys(ops)
  if (keys.length !== 1 || keys[0] !== '$inc') return false
  const inc = ops.$inc as Record<string, unknown>
  return Object.keys(inc).every((key) => key === 'sequence')
}

function forbidden (): never {
  throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
}

const moduleSettings = departmentModuleSettingsClass as Ref<Class<Doc & { enabled: boolean }>>
const moduleGrant = departmentModuleGrantClass as Ref<Class<Doc & DepartmentModuleException & { person: string }>>
const settingsId = departmentModuleSettingsId as Ref<Doc>
const grantId = (person: string): Ref<Doc> => ('departments:module-grant:' + person) as Ref<Doc>

/** Server-side enforcement of department roles on department pages and department spaces. */
export class DepartmentGuardMiddleware extends BaseMiddleware implements Middleware {
  private departments: DepartmentRecord[] = []
  private bySpace = new Map<Ref<Space>, DepartmentRecord>()
  private dirty = true

  static async create (
    _ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<DepartmentGuardMiddleware> {
    return new DepartmentGuardMiddleware(context, next)
  }

  private async load (ctx: MeasureContext): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    if (!this.context.hierarchy.hasClass(departmentClass)) return
    const docs = (await this.next?.findAll(ctx, departmentClass, {})) ?? []
    this.departments = docs.flatMap((doc) => readDepartment(doc) ?? [])
    this.bySpace = new Map(this.departments.flatMap((d) => d.spaces.map((space) => [space, d] as const)))
  }

  private moduleDefaults () {
    return this.departments.map((dept) => ({
      members: dept.members,
      moduleAccess: dept.moduleAccess as ModuleAccess | undefined,
      archived: dept.archived,
      modules: Array.isArray(dept.modules) ? list(dept.modules) : undefined
    }))
  }

  private async moduleAccess (ctx: MeasureContext<SessionData>) {
    const account = ctx.contextData.account
    if (isOwner(account, ctx) || !this.context.hierarchy.hasClass(moduleSettings)) return undefined
    const settings = await this.findOne(ctx, moduleSettings, settingsId) as { enabled?: boolean } | undefined
    if (settings?.enabled !== true) return undefined
    await this.load(ctx)
    const grant = await this.findOne(ctx, moduleGrant, grantId(account.uuid)) as (Doc & DepartmentModuleException) | undefined
    return effectiveDepartmentModules(account.uuid, false, true, this.moduleDefaults(), grant)
  }

  private protectedModule (_class: Ref<Class<Doc>>): string | undefined {
    if ([orderClass, orderActionClass, orderFlowClass].includes(_class)) return 'orders'
    if ([auditEventClass, trackingSettingsClass].includes(_class)) return 'tracking'
    const alias = _class.split(':')[0]
    if (alias === 'inventory' || alias === 'prospects') return alias
  }

  override async findAll<T extends Doc> (
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<FindResult<T>> {
    const alias = this.protectedModule(_class)
    if (alias !== undefined && !isSystem(ctx.contextData.account, ctx)) {
      if ((await this.moduleAccess(ctx))?.(alias) === 'none') return toFindResult([])
    }
    return await this.provideFindAll(ctx, _class, query, options)
  }

  override async searchFulltext (
    ctx: MeasureContext<SessionData>, query: SearchQuery, options: SearchOptions
  ): Promise<SearchResult> {
    const allowed = isSystem(ctx.contextData.account, ctx) ? undefined : await this.moduleAccess(ctx)
    if (allowed === undefined) return await super.searchFulltext(ctx, query, options)
    const canRead = (cls: Ref<Class<Doc>>): boolean => {
      const alias = this.protectedModule(cls)
      return alias === undefined || allowed(alias) !== 'none'
    }
    const classes = query.classes?.filter(canRead)
    if (classes?.length === 0 && query.classes?.length !== 0) return { docs: [], total: 0 }
    const result = await super.searchFulltext(ctx, { ...query, classes }, options)
    const docs = result.docs.filter(({ doc }) => canRead(doc._class) &&
      (doc.attachedToClass === undefined || canRead(doc.attachedToClass)))
    return { docs, total: docs.length }
  }

  private async checkModuleConfiguration (ctx: MeasureContext<SessionData>, tx: TxCUD<Doc>): Promise<void> {
    const account = ctx.contextData.account
    const owner = isOwner(account, ctx)
    if (tx.objectSpace !== core.space.Workspace) forbidden()
    const creating = tx._class === core.class.TxCreateDoc
    if (!creating && tx._class !== core.class.TxUpdateDoc) forbidden()
    const fields = (creating ? (tx as TxCreateDoc<Doc>).attributes : (tx as TxUpdateDoc<Doc>).operations) as Record<string, unknown>
    if (tx.objectClass === moduleSettings) {
      if (!owner || tx.objectId !== settingsId || typeof fields.enabled !== 'boolean' ||
        Object.keys(fields).some((key) => key !== 'enabled')) forbidden()
      return
    }
    const existing = creating ? undefined : await this.findOne(ctx, moduleGrant, tx.objectId)
    if (!creating && existing === undefined) forbidden()
    const before = existing as (Doc & DepartmentModuleException & { person: string }) | undefined
    const person = creating ? fields.person : before?.person
    if (typeof person !== 'string' || tx.objectId !== grantId(person) ||
      Object.keys(fields).some((key) => key !== 'extra' && key !== 'blocked' && !(creating && key === 'person'))) forbidden()
    const extra = fields.extra
    const blocked = fields.blocked
    if (extra === null || typeof extra !== 'object' || Array.isArray(extra) ||
      Object.entries(extra).some(([alias, level]) => alias.trim() === '' || (level !== 'view' && level !== 'edit')) ||
      !Array.isArray(blocked) || blocked.some((alias) => typeof alias !== 'string' || alias.trim() === '')) forbidden()
    if (!owner && !canChangeDepartmentModuleException(account.uuid, person, this.moduleDefaults(),
      (await this.moduleAccess(ctx)) ?? (() => 'edit'), before ?? { extra: {}, blocked: [] }, { extra: extra as ModuleExtra, blocked })) forbidden()
  }

  private touchesDepartments (tx: Tx): boolean {
    if (tx._class === core.class.TxApplyIf) return (tx as TxApplyIf).txes.some((it) => this.touchesDepartments(it))
    return TxProcessor.isExtendsCUD(tx._class) && (tx as TxCUD<Doc>).objectClass === departmentClass
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    const account = ctx.contextData.account
    if (!isSystem(account, ctx)) {
      await this.load(ctx)
      for (const tx of txes) await this.check(ctx, tx)
    }
    if (txes.some((tx) => this.touchesDepartments(tx))) this.dirty = true
    const result = await this.provideTx(ctx, txes)
    // Space ids are written back by the sync trigger as derived transactions.
    if (ctx.contextData.broadcast.txes.some((tx) => this.touchesDepartments(tx))) this.dirty = true
    return result
  }

  private async check (ctx: MeasureContext<SessionData>, tx: Tx): Promise<void> {
    if (tx._class === core.class.TxApplyIf) {
      for (const it of (tx as TxApplyIf).txes) await this.check(ctx, it)
      return
    }
    if (!TxProcessor.isExtendsCUD(tx._class)) return
    const cud = tx as TxCUD<Doc>
    if (cud.objectClass === moduleSettings || cud.objectClass === moduleGrant) {
      await this.checkModuleConfiguration(ctx, cud)
      return
    }
    const alias = this.protectedModule(cud.objectClass) ??
      (cud.attachedToClass === undefined ? undefined : this.protectedModule(cud.attachedToClass))
    if (alias !== undefined) {
      const level = (await this.moduleAccess(ctx))?.(alias) ?? 'edit'
      if (level === 'none' || (level === 'view' && cud.objectClass !== orderActionClass)) forbidden()
    }
    if (cud.objectClass === auditEventClass || cud.objectClass === trackingSettingsClass) {
      await this.checkAudit(ctx, cud)
      return
    }
    if (cud.objectClass === orderClass || cud.objectClass === orderActionClass || cud.objectClass === orderFlowClass) {
      await this.checkOrders(ctx, cud)
      return
    }
    if (cud.objectClass === departmentClass) {
      await this.checkDepartment(ctx, cud)
      return
    }
    const owner = isOwner(ctx.contextData.account, ctx)
    const ownSpace = this.bySpace.get(cud.objectId as Ref<Space>)
    if (ownSpace !== undefined) {
      // Changing a department space itself: only the issue counter, only for members who may create.
      if (owner) return
      if (!isCounterUpdate(cud)) forbidden()
      this.require(ctx, ownSpace, 'create')
      return
    }
    const target = this.bySpace.get(cud.objectSpace)
    const movedTo =
      cud._class === core.class.TxUpdateDoc
        ? this.bySpace.get((cud as TxUpdateDoc<Doc>).operations.space as Ref<Space>)
        : undefined
    if (movedTo !== undefined && !owner) this.require(ctx, movedTo, 'create')
    if (target === undefined || owner) return
    const permission = await this.classify(ctx, cud)
    if (permission === undefined) forbidden()
    this.require(ctx, target, permission)
  }

  private require (
    ctx: MeasureContext<SessionData>,
    department: DepartmentRecord,
    permission: DepartmentPermission
  ): void {
    const allowed = effectivePermissions(department.members, department.policy, ctx.contextData.account.uuid)
    if (department.archived || !allowed.has(permission)) forbidden()
  }

  private async findOne (
    ctx: MeasureContext,
    _class: Ref<Class<Doc>> | undefined,
    _id: Ref<Doc> | undefined
  ): Promise<Doc | undefined> {
    if (_class === undefined || _id === undefined) return undefined
    return (await this.next?.findAll(ctx, _class, { _id }, { limit: 1 }))?.[0]
  }

  private async classify (ctx: MeasureContext<SessionData>, tx: TxCUD<Doc>): Promise<DepartmentPermission | undefined> {
    const hierarchy = this.context.hierarchy
    const action =
      tx._class === core.class.TxCreateDoc
        ? 'create'
        : tx._class === core.class.TxUpdateDoc
          ? 'update'
          : tx._class === core.class.TxRemoveDoc
            ? 'remove'
            : tx._class === core.class.TxMixin
              ? 'mixin'
              : 'unknown'
    // Author and parent always come from storage, never from the transaction.
    const existing = action === 'create' ? undefined : await this.findOne(ctx, tx.objectClass, tx.objectId)
    const parent =
      action === 'create'
        ? await this.findOne(ctx, (tx as TxCreateDoc<Doc>).attachedToClass ?? tx.attachedToClass, tx.attachedTo)
        : undefined
    const sameSpaceParent = parent !== undefined && parent.space === tx.objectSpace ? parent._class : undefined
    return classifyDepartmentAction({
      action,
      objectClass: tx._class === core.class.TxMixin ? (tx as TxMixin<Doc, Doc>).objectClass : tx.objectClass,
      parentClass: sameSpaceParent,
      existingAuthor: existing?.createdBy,
      actorIdentities: new Set<string>(ctx.contextData.account.socialIds),
      isDerived: (child, ancestor) =>
        hierarchy.hasClass(child as Ref<Class<Doc>>) &&
        hierarchy.hasClass(ancestor as Ref<Class<Doc>>) &&
        hierarchy.isDerived(child as Ref<Class<Doc>>, ancestor as Ref<Class<Doc>>)
    })
  }

  private readonly roleOf: RoleOf = (department, person) => {
    const record = this.departments.find((it) => it._id === department)
    if (record === undefined || record.archived) return undefined
    return departmentRoles.find((role) => record.members[role].includes(person))
  }

  /**
   * Tracking records: people only add their own (and bump the count of their own repeated
   * page opens); nobody edits or deletes them except the system. Settings are for super admins.
   */
  private async checkAudit (ctx: MeasureContext<SessionData>, tx: TxCUD<Doc>): Promise<void> {
    const owner = isOwner(ctx.contextData.account, ctx)
    const actor = ctx.contextData.account.uuid
    if (tx.objectClass === trackingSettingsClass) {
      if (!owner || tx._class === core.class.TxRemoveDoc) forbidden()
      return
    }
    if (tx._class === core.class.TxCreateDoc) {
      const attributes = (tx as TxCreateDoc<Doc>).attributes as unknown as Record<string, unknown>
      if (attributes.actor !== actor || !auditKinds.includes(attributes.kind as string)) forbidden()
      if (attributes.count !== 1) forbidden()
      return
    }
    if (tx._class !== core.class.TxUpdateDoc) forbidden()
    const ops = (tx as TxUpdateDoc<Doc>).operations as Record<string, unknown>
    if (Object.keys(ops).some((key) => key !== 'count' && key !== 'lastOn')) forbidden()
    const event = (await this.findOne(ctx, auditEventClass, tx.objectId)) as unknown as
      | { actor: string, count: number }
      | undefined
    if (event === undefined || event.actor !== actor) forbidden()
    if (ops.count !== undefined && ops.count !== event.count + 1) forbidden()
  }

  /** Orders move only through checked OrderAction records; the system applies them. */
  private async checkOrders (ctx: MeasureContext<SessionData>, tx: TxCUD<Doc>): Promise<void> {
    const owner = isOwner(ctx.contextData.account, ctx)
    const actor = ctx.contextData.account.uuid
    const create = tx._class === core.class.TxCreateDoc
    const attributes = create ? ((tx as TxCreateDoc<Doc>).attributes as unknown as Record<string, unknown>) : {}
    if (tx.objectClass === orderActionClass) {
      // The history is never edited, not even by super admins.
      if (!create || attributes.actor !== actor) forbidden()
      const order = await this.findOne(ctx, orderClass, attributes.order as Ref<Doc>)
      if (order === undefined) forbidden()
      const live = this.departments.filter((d) => !d.archived)
      const ok = canOrderAction(order as unknown as OrderLike, attributes as any, actor, owner, this.roleOf, {
        adminSomewhere: live.some((d) => d.members.admin.includes(actor)),
        departments: live.map((d) => d._id as string)
      })
      if (!ok) forbidden()
      return
    }
    if (tx.objectClass === orderClass) {
      if (create) {
        const works = this.departments.some(
          (d) => !d.archived && departmentRoles.some((r) => r !== 'reader' && d.members[r].includes(actor))
        )
        if (!canCreateOrder(attributes, actor, owner, works)) forbidden()
        return
      }
      if (tx._class !== core.class.TxUpdateDoc) {
        if (!owner) forbidden()
        return
      }
      const order = await this.findOne(ctx, orderClass, tx.objectId)
      if (order === undefined) forbidden()
      const ops = (tx as TxUpdateDoc<Doc>).operations as Record<string, unknown>
      if (!canEditOrder(ops, actor, owner, order as unknown as OrderLike)) forbidden()
      return
    }
    // Order flow template
    if (create) {
      if (!owner) forbidden()
      return
    }
    if (tx._class !== core.class.TxUpdateDoc) forbidden()
    const ops = (tx as TxUpdateDoc<Doc>).operations as Record<string, unknown>
    if (Object.keys(ops).some((key) => key !== 'stages') || !Array.isArray(ops.stages)) forbidden()
    const flow = await this.findOne(ctx, orderFlowClass, tx.objectId)
    const before = ((flow as unknown as { stages?: unknown[] } | undefined)?.stages ?? []) as any[]
    if (!canChangeFlow(before, ops.stages, actor, owner, this.roleOf)) forbidden()
  }

  private async checkDepartment (ctx: MeasureContext<SessionData>, tx: TxCUD<Doc>): Promise<void> {
    const owner = isOwner(ctx.contextData.account, ctx)
    const before = this.departments.find((d) => d._id === tx.objectId)
    if (tx._class === core.class.TxCreateDoc) return // A plain HR department; access is added by a mixin.
    if (tx._class !== core.class.TxMixin || (tx as TxMixin<Doc, Doc>).mixin !== departmentAccessMixin) {
      // Renaming, moving or removing a managed department belongs to the super admins.
      if (before !== undefined && !owner) forbidden()
      return
    }
    const mixinTx = tx as TxMixin<Doc, Doc>
    const attributes = mixinTx.attributes as Record<string, unknown>
    // Space links are written only by the sync trigger.
    if (spaceFields.some((field) => field in attributes)) forbidden()
    // The page creates the department and its access in one step, so it may not be stored yet;
    // a department that does not exist has no members, which only super admins may change.
    const doc =
      (await this.findOne(ctx, departmentClass, tx.objectId)) ??
      ({ _id: tx.objectId, _class: departmentClass, space: tx.objectSpace } as unknown as Doc)
    const next = readDepartment(TxProcessor.updateMixin4Doc(clone(doc) as Doc, mixinTx))
    if (next === undefined) forbidden()
    const empty = { admin: [], supervisor: [], employee: [], reader: [] }
    const old = before ?? { members: empty, policy: empty, archived: false }
    if (!owner && next.archived !== old.archived) forbidden()
    // Whether supervisors see tracking is decided by super admins; staff by the department admin.
    const before2 = before ?? { supervisorsSeeTracking: false, employeesSeeTracking: false }
    if (!owner && next.supervisorsSeeTracking !== before2.supervisorsSeeTracking) forbidden()
    if (!owner && next.employeesSeeTracking !== before2.employeesSeeTracking && !(old.members.admin as string[]).includes(ctx.contextData.account.uuid)) {
      forbidden()
    }
    if (!canChangeDepartmentOptions(owner, old.members.admin.includes(ctx.contextData.account.uuid), before ?? {}, next)) forbidden()
    const matrix = next.moduleAccess
    if (JSON.stringify(matrix) !== JSON.stringify(before?.moduleAccess)) {
      if (!owner || matrix === null || typeof matrix !== 'object' || Array.isArray(matrix)) forbidden()
      for (const [alias, row] of Object.entries(matrix)) {
        if (alias.trim() === '' || row === null || typeof row !== 'object' ||
          Object.keys(row).length !== moduleRoles.length ||
          !moduleRoles.every((role) => ['none', 'view', 'edit'].includes(row[role]))) forbidden()
      }
    }
    const ok = canChangeDepartment(
      ctx.contextData.account.uuid,
      owner,
      old.members,
      next.members,
      old.policy,
      next.policy
    )
    if (!ok) forbidden()
  }
}
