// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import core, {
  AccountRole,
  TxProcessor,
  canChangeDepartmentModuleException,
  departmentModuleGrantClass,
  departmentAutoJoinClasses,
  departmentModuleSettingsClass,
  departmentModuleSettingsId,
  effectiveDepartmentModules,
  companyModuleDefault,
  type CompanyModuleDefaults,
  toFindResult,
  moduleRoles,
  type ModuleAccess,
  applicationFormTypes,
  applicationProcessClass,
  type ModuleExtra,
  type DepartmentModuleException,
  type DocumentQuery,
  type DomainParams,
  type DomainResult,
  type OperationDomain,
  type FindOptions,
  type FindResult,
  type WithLookup,
  type AssociationQuery,
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
import { canChangeFlow, canCreateOrder, canEditOrder, canOrderAction, orderPaymentBlocksAction, type OrderLike, type RoleOf } from './orderPolicy'
import { isOwner, isSystem } from './utils'
import {
  applicationRelatedClasses,
  approveRequestClass,
  canSeeApplication,
  referencesHiddenApplication,
  attachmentClass,
  canChangeExecutionStatus,
  canChangeRequest,
  cardBaseClass,
  executionClass,
  isApplicationLocked,
  touchesApplicationContent,
  type RequestLike
} from './applicationPolicy'

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
  autoJoin?: unknown
  orderAssignee?: unknown
  applicationTypes: string[]
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
    autoJoin: access.autoJoin,
    orderAssignee: access.orderAssignee,
    applicationTypes: list(access.applicationTypes),
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

type ModuleSettingsDoc = Doc & { enabled: boolean, companyDefaults?: CompanyModuleDefaults }
const moduleSettings = departmentModuleSettingsClass as Ref<Class<ModuleSettingsDoc>>
const moduleGrant = departmentModuleGrantClass as Ref<Class<Doc & DepartmentModuleException & { person: string }>>
const settingsId = departmentModuleSettingsId as Ref<Doc>
const grantId = (person: string): Ref<Doc> => ('departments:module-grant:' + person) as Ref<Doc>

/** Server-side enforcement of department roles on department pages and department spaces. */
export class DepartmentGuardMiddleware extends BaseMiddleware implements Middleware {
  private departments: DepartmentRecord[] = []
  private bySpace = new Map<Ref<Space>, DepartmentRecord>()
  private dirty = true
  private loadingDepartments?: Promise<void>
  private moduleConfiguration?: Promise<ModuleSettingsDoc | undefined>
  private readonly grants = new Map<string, Promise<DepartmentModuleException | undefined>>()

  static async create (
    _ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<DepartmentGuardMiddleware> {
    return new DepartmentGuardMiddleware(context, next)
  }

  private async load (ctx: MeasureContext): Promise<void> {
    if (this.loadingDepartments !== undefined) {
      await this.loadingDepartments
      await this.load(ctx)
      return
    }
    if (!this.dirty) return
    this.dirty = false
    if (!this.context.hierarchy.hasClass(departmentClass)) return
    const pending = (async (): Promise<void> => {
      const docs = (await this.next?.findAll(ctx, departmentClass, {})) ?? []
      this.departments = docs.flatMap((doc) => readDepartment(doc) ?? [])
      this.bySpace = new Map(this.departments.flatMap((d) => d.spaces.map((space) => [space, d] as const)))
    })()
    this.loadingDepartments = pending
    try {
      await pending
    } catch (err) {
      this.dirty = true
      throw err
    } finally {
      this.loadingDepartments = undefined
    }
  }

  private moduleDefaults () {
    return this.departments.map((dept) => ({
      members: dept.members,
      moduleAccess: dept.moduleAccess as ModuleAccess | undefined,
      archived: dept.archived,
      modules: Array.isArray(dept.modules) ? list(dept.modules) : undefined
    }))
  }

  private readModuleSettings (ctx: MeasureContext<SessionData>): Promise<ModuleSettingsDoc | undefined> {
    if (this.moduleConfiguration === undefined) {
      const pending = this.findOne(ctx, moduleSettings, settingsId)
        .then((settings) => settings as ModuleSettingsDoc | undefined)
        .catch((err) => {
          if (this.moduleConfiguration === pending) this.moduleConfiguration = undefined
          throw err
        })
      this.moduleConfiguration = pending
    }
    return this.moduleConfiguration
  }

  private readGrant (ctx: MeasureContext<SessionData>, person: string): Promise<DepartmentModuleException | undefined> {
    const existing = this.grants.get(person)
    if (existing !== undefined) return existing
    const pending = this.findOne(ctx, moduleGrant, grantId(person))
      .then((grant) => grant as (Doc & DepartmentModuleException) | undefined)
      .catch((err) => {
        if (this.grants.get(person) === pending) this.grants.delete(person)
        throw err
      })
    this.grants.set(person, pending)
    return pending
  }

  private async moduleAccess (ctx: MeasureContext<SessionData>, enforceCeiling = false) {
    const account = ctx.contextData.account
    if (isOwner(account, ctx) || !this.context.hierarchy.hasClass(moduleSettings)) return undefined
    const settings = await this.readModuleSettings(ctx)
    if (!enforceCeiling && settings?.enabled !== true) return undefined
    await this.load(ctx)
    const grant = await this.readGrant(ctx, account.uuid)
    return effectiveDepartmentModules(account.uuid, false, true, this.moduleDefaults(), grant,
      companyModuleDefault(settings?.companyDefaults, account.role))
  }

  private protectedModule (_class: Ref<Class<Doc>>): string | undefined {
    if ([orderClass, orderActionClass, orderFlowClass].includes(_class)) return 'orders'
    if ([auditEventClass, trackingSettingsClass].includes(_class)) return 'tracking'
    if (_class === 'whatsapp:class:Message') return 'whatsapp'
    const alias = _class.split(':')[0]
    if (alias === 'materials' || alias === 'prospects') return alias
  }

  // Auraplex: coalesce live reads per identity, and keep historical approval reads separate.
  private readonly hiddenApplicationIds = new Map<string, { expires: number, value: Promise<Set<string>> }>()
  private readonly approvalCards = new Map<string, { expires: number, value: Promise<Set<string>> }>()

  private async cachedApplicationIds (
    ctx: MeasureContext<SessionData>, cache: Map<string, { expires: number, value: Promise<Set<string>> }>,
    calculate: () => Promise<Set<string>>, maxAge = 30_000
  ): Promise<Set<string>> {
    const { account, grant } = ctx.contextData
    const key = JSON.stringify([account.uuid, account.role, account.socialIds, grant?.spaces])
    let entry = cache.get(key)
    if (entry === undefined || entry.expires <= Date.now()) {
      if (cache.size >= 128) cache.clear()
      entry = { expires: Date.now() + maxAge, value: calculate() }
      cache.set(key, entry)
    }
    try {
      const value = await entry.value
      // A write can invalidate this decision while the database reads are in flight.
      if (cache.get(key) !== entry) return await this.cachedApplicationIds(ctx, cache, calculate, maxAge)
      return value
    } catch (err) {
      if (cache.get(key) === entry) cache.delete(key)
      throw err
    }
  }

  private async hiddenApplications (ctx: MeasureContext<SessionData>): Promise<Set<string>> {
    const { account } = ctx.contextData
    if (isOwner(account, ctx) || account.role === AccountRole.Maintainer) return new Set()
    return await this.cachedApplicationIds(ctx, this.hiddenApplicationIds, () => this.calculateHiddenApplications(ctx))
  }

  private invalidateApplicationIds (transactions: Tx[]): void {
    for (const tx of transactions) {
      if (tx._class === core.class.TxApplyIf) {
        this.invalidateApplicationIds((tx as TxApplyIf).txes)
        continue
      }
      if (!TxProcessor.isExtendsCUD(tx._class)) continue
      const { objectClass, objectSpace } = tx as TxCUD<Doc>
      const approvalChanged = objectClass === approveRequestClass || objectClass === 'contact:class:Person'
      const hierarchy = this.context.hierarchy
      const card = cardBaseClass as Ref<Class<Doc>>
      const cardChanged = typeof hierarchy.isDerived === 'function' && hierarchy.hasClass(card) &&
        hierarchy.hasClass(objectClass) && hierarchy.isDerived(objectClass, card)
      if (objectClass === departmentClass) this.dirty = true
      if (approvalChanged) this.approvalCards.clear()
      if (approvalChanged || cardChanged || objectClass === departmentClass ||
        objectClass === applicationProcessClass || objectSpace === core.space.Model) this.hiddenApplicationIds.clear()
    }
  }

  override async handleBroadcast (ctx: MeasureContext<SessionData>): Promise<void> {
    this.invalidateApplicationIds(ctx.contextData.broadcast.txes)
    await super.handleBroadcast(ctx)
  }

  private async findApprovalCards (ctx: MeasureContext<SessionData>): Promise<Set<string>> {
    const person = await this.next?.findAll(ctx, 'contact:class:Person' as Ref<Class<Doc>>, {
      personUuid: ctx.contextData.account.uuid
    }, { limit: 1 })
    const myApprovalCards = new Set<string>()
    if (person?.[0] !== undefined) {
      type ApprovalRecord = Doc & { card: Ref<Doc>, user: Ref<Doc> }
      const requestClass = approveRequestClass as Ref<Class<ApprovalRecord>>
      const user = person[0]._id
      const [requests, assigned, reassigned] = await Promise.all([
        this.next?.findAll(ctx, requestClass, { user }),
        this.next?.findAll(ctx, core.class.TxCreateDoc, { objectClass: requestClass, 'attributes.user': user }),
        this.next?.findAll(ctx, core.class.TxUpdateDoc, { objectClass: requestClass, 'operations.user': user })
      ])
      for (const request of requests ?? []) myApprovalCards.add(request.card)
      const previousIds = [...new Set([...(assigned ?? []), ...(reassigned ?? [])].map((tx) => tx.objectId as Ref<ApprovalRecord>))]
      if (previousIds.length > 0) {
        const previous = await this.next?.findAll(ctx, requestClass, { _id: { $in: previousIds } })
        for (const request of previous ?? []) myApprovalCards.add(request.card)
      }
    }
    return myApprovalCards
  }

  private async calculateHiddenApplications (ctx: MeasureContext<SessionData>): Promise<Set<string>> {
    const account = ctx.contextData.account
    const hierarchy = this.context.hierarchy
    const cardClass = cardBaseClass as Ref<Class<Doc>>
    if (isOwner(account, ctx) || account.role === AccountRole.Maintainer ||
      !hierarchy.hasClass(applicationProcessClass) || !hierarchy.hasClass(cardClass)) return new Set()
    const forms = applicationFormTypes(hierarchy, (await this.next?.findAll(ctx, applicationProcessClass, {})) ?? [])
    if (forms.length === 0) return new Set()
    const expand = (types: Ref<Class<Doc>>[]): Ref<Class<Doc>>[] =>
      [...new Set(types.flatMap((type) => [type, ...hierarchy.getDescendants(type) as Ref<Class<Doc>>[]]))]
    await this.load(ctx)
    const assignedTypes = new Set(this.departments.flatMap((department) =>
      !department.archived && (department.members.admin.includes(account.uuid) || department.members.supervisor.includes(account.uuid))
        ? forms.filter((type) => department.applicationTypes.includes(type))
        : []))
    const myDepartmentTypes = new Set(expand([...assignedTypes]))
    const cards = await this.next?.findAll(ctx, cardClass, { _class: { $in: expand(forms) } }, {
      projection: { _id: 1, _class: 1, createdBy: 1 }
    })
    if (cards == null || cards.length === 0) return new Set()
    const myApprovalCards = await this.cachedApplicationIds(ctx, this.approvalCards, async () => await this.findApprovalCards(ctx), 300_000)
    const mySocialIds = new Set(account.socialIds)
    return new Set(cards.filter((card) => !canSeeApplication({
      id: card._id, type: card._class, createdBy: card.createdBy, mySocialIds, myApprovalCards, myDepartmentTypes
    })).map((card) => card._id))
  }

  private applicationReadClass (_class: Ref<Class<Doc>>): boolean {
    const hierarchy = this.context.hierarchy
    if (!hierarchy.hasClass(_class) || typeof hierarchy.isDerived !== 'function') return false
    return [cardBaseClass, ...applicationRelatedClasses, core.class.Tx].some((id) => {
      const base = id as Ref<Class<Doc>>
      return hierarchy.hasClass(base) && (hierarchy.isDerived(_class, base) || hierarchy.isDerived(base, _class))
    })
  }

  // Auraplex: communication does not pass through findAll.
  override async domainRequest (
    ctx: MeasureContext<SessionData>, domain: OperationDomain, args: DomainParams
  ): Promise<DomainResult> {
    // Auraplex: blob gateways resolve protected attachment parents using a service account.
    if (domain === 'application-attachment') {
      if (ctx.contextData === undefined || !isSystem(ctx.contextData.account, ctx)) forbidden()
      if (typeof args.file !== 'string' || args.file === '') forbidden()
      const hierarchy = this.context.hierarchy
      const attachments = attachmentClass as Ref<Class<Doc & { attachedTo: Ref<Doc> }>>
      const cards = cardBaseClass as Ref<Class<Doc>>
      if (!hierarchy.hasClass(attachments) || !hierarchy.hasClass(cards) || !hierarchy.hasClass(applicationProcessClass)) {
        return { domain, value: [] }
      }
      const files = await this.next?.findAll(ctx, attachments, { file: args.file })
      if (files == null || files.length === 0) return { domain, value: [] }
      const parents = [...new Set(files.map((file) => file.attachedTo))]
      const forms = applicationFormTypes(hierarchy, (await this.next?.findAll(ctx, applicationProcessClass, {})) ?? [])
      const matches = await this.next?.findAll(ctx, cards, { _id: { $in: parents } })
      return { domain, value: (matches ?? []).filter((card) =>
        forms.some((type) => hierarchy.isDerived(card._class, type))).map((card) => card._id) }
    }
    // Auraplex: direct WhatsApp attachment sending must obey the same module policy as queued sends.
    if (domain === 'whatsapp-media') {
      if (ctx.contextData === undefined) forbidden()
      const access = await this.moduleAccess(ctx)
      return { domain, value: access === undefined || access('whatsapp') === 'edit' }
    }
    if (domain !== 'communication' || ctx.contextData === undefined) {
      return await this.provideDomainRequest(ctx, domain, args)
    }
    const filteringBroadcast = Array.isArray(args.filterApplicationBroadcast)
    const account = ctx.contextData.account
    const hidden = await this.hiddenApplications(ctx)
    const blocked = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(blocked)
      if (value == null || typeof value !== 'object') return false
      const record = value as Record<string, unknown>
      const ids = Array.isArray(record.cardId) ? record.cardId : [record.cardId]
      return ids.some((id) => typeof id === 'string' && hidden.has(id)) ||
        ['card', 'message', 'notification', 'context', 'peer', 'thread'].some((key) => blocked(record[key]))
    }
    if (filteringBroadcast) {
      return { domain, value: args.filterApplicationBroadcast.filter((event: unknown) => !blocked(event)) }
    }
    if (hidden.size === 0) return await this.provideDomainRequest(ctx, domain, args)
    if (args.event !== undefined) {
      if (blocked(args.event)) forbidden()
      const contextId = args.event.contextId
      if (typeof contextId === 'string') {
        const contexts = await this.provideDomainRequest(ctx, domain, {
          findNotificationContexts: { params: { id: contextId, account: account.uuid } }
        })
        if (blocked(contexts.value)) forbidden()
      }
    }
    if (blocked(args.subscribeCard)) return { domain, value: undefined }
    if (Object.entries(args).some(([key, command]) => key.startsWith('find') && blocked(command?.params))) {
      return { domain, value: [] }
    }
    const result = await this.provideDomainRequest(ctx, domain, args)
    if (!Array.isArray(result.value)) return result
    const visible = result.value.filter((row: unknown) => !blocked(row))
    if ('total' in result.value) Object.assign(visible, { total: visible.length })
    return { ...result, value: visible }
  }

  override async findAll<T extends Doc> (
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<FindResult<T>> {
    // Internal loads (e.g. space security init) run without a user context.
    if (ctx.contextData === undefined || isSystem(ctx.contextData.account, ctx)) return await this.provideFindAll(ctx, _class, query, options)
    const allowed = await this.moduleAccess(ctx)
    const canSeeAll = isOwner(ctx.contextData.account, ctx) || ctx.contextData.account.role === AccountRole.Maintainer
    const joins = options?.lookup !== undefined || options?.associations !== undefined
    const hidden = !canSeeAll && (joins || this.applicationReadClass(_class))
      ? await this.hiddenApplications(ctx)
      : new Set<string>()
    if (allowed === undefined && hidden.size === 0) return await this.provideFindAll(ctx, _class, query, options)
    const canRead = (cls: Ref<Class<Doc>>): boolean => {
      const alias = this.protectedModule(cls)
      return alias === undefined || allowed?.(alias) !== 'none'
    }
    if (!canRead(_class)) return toFindResult([])
    let deniedLookup = false
    const filterLookup = (entry: unknown): unknown => {
      if (typeof entry === 'string') {
        if (canRead(entry as Ref<Class<Doc>>)) return entry
        deniedLookup = true
        return undefined
      }
      if (Array.isArray(entry)) {
        const target = filterLookup(entry[0])
        if (target === undefined) return undefined
        return typeof entry[1] === 'string' ? [target, entry[1]] : [target, filterLookup(entry[1])]
      }
      if (entry == null || typeof entry !== 'object') return entry
      return Object.fromEntries(Object.entries(entry).flatMap(([key, value]) => {
        const safe = filterLookup(value)
        return safe === undefined ? [] : [[key, safe]]
      }))
    }
    const lookup = filterLookup(options?.lookup) as FindOptions<T>['lookup']
    // A filter or sort on a removed join must not expose matching rows or counts.
    if ((deniedLookup || (hidden.size > 0 && joins)) && /\$(lookup|associations)\./.test(JSON.stringify([query, options?.sort]))) return toFindResult([])
    const filterAssociations = (entries: AssociationQuery[] | undefined): AssociationQuery[] | undefined =>
      entries?.flatMap((entry): AssociationQuery[] => {
        const [id, direction, nested] = entry
        const association = this.context.modelDb.findObject(id)
        if (association === undefined || !canRead(direction === -1 ? association.classA : association.classB)) return []
        const safeNested = filterAssociations(nested)
        return [safeNested === undefined ? [id, direction] : [id, direction, safeNested]]
      })
    const associations = filterAssociations(options?.associations)
    // Filter before applying the client's limit so a count or empty first page cannot disclose hidden rows.
    const filterRoot = hidden.size > 0 && this.applicationReadClass(_class)
    const result = await this.provideFindAll(ctx, _class, query,
      options === undefined ? undefined : {
        ...options, lookup, associations,
        ...(filterRoot ? { limit: undefined, projection: undefined } : {})
      })
    if (!filterRoot && lookup === undefined && options?.associations === undefined) return result

    const clean = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(clean).filter((item) => item !== undefined)
      if (value == null || typeof value !== 'object') return value
      if (referencesHiddenApplication(value, hidden)) return undefined
      const doc = value as WithLookup<Doc>
      if (typeof doc._class === 'string') {
        if (!canRead(doc._class) ||
          referencesHiddenApplication((doc as unknown as TxCreateDoc<Doc>).attributes, hidden) ||
          referencesHiddenApplication((doc as unknown as TxUpdateDoc<Doc>).operations, hidden)) return undefined
        return {
          ...doc,
          ...(doc.$lookup === undefined ? {} : { $lookup: clean(doc.$lookup) }),
          ...(doc.$associations === undefined ? {} : { $associations: clean(doc.$associations) })
        }
      }
      return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
        const safe = clean(item)
        return safe === undefined ? [] : [[key, safe]]
      }))
    }
    const safeLookupMap = clean(result.lookupMap) as typeof result.lookupMap
    const visible = result.map((doc) => clean(doc) as T).filter((doc) => doc !== undefined)
    if (!filterRoot) return toFindResult(visible, result.total, safeLookupMap)
    const page = options?.limit === undefined ? visible : visible.slice(0, options.limit)
    // Application reads keep the metadata used by the existing client even for projected requests.
    if (options?.projection !== undefined) {
      const inclusion = Object.values(options.projection).some((flag) => flag === 1)
      const keys = new Set(['_id', '_class', ...Object.keys(options.projection)])
      return toFindResult(page.map((doc) => Object.fromEntries(Object.entries(doc).filter(([key]) =>
        (!inclusion || keys.has(key)) && options.projection?.[key as keyof T] !== 0)) as T), visible.length, safeLookupMap)
    }
    return toFindResult(page, visible.length, safeLookupMap)
  }

  override async searchFulltext (
    ctx: MeasureContext<SessionData>, query: SearchQuery, options: SearchOptions
  ): Promise<SearchResult> {
    // Auraplex: remove private application hits before sending search snippets to the browser.
    if (ctx.contextData === undefined || isSystem(ctx.contextData.account, ctx)) {
      return await super.searchFulltext(ctx, query, options)
    }
    const [allowed, hidden] = await Promise.all([this.moduleAccess(ctx), this.hiddenApplications(ctx)])
    if (allowed === undefined && hidden.size === 0) return await super.searchFulltext(ctx, query, options)
    const canRead = (cls: Ref<Class<Doc>>): boolean => {
      const alias = this.protectedModule(cls)
      return alias === undefined || allowed?.(alias) !== 'none'
    }
    const classes = query.classes?.filter(canRead)
    if (classes?.length === 0 && query.classes?.length !== 0) return { docs: [], total: 0 }
    const result = await super.searchFulltext(ctx, { ...query, classes }, options)
    const docs = result.docs.filter(({ doc, id }) => !hidden.has(id) && !referencesHiddenApplication(doc, hidden) &&
      canRead(doc._class) && (doc.attachedToClass === undefined || canRead(doc.attachedToClass)))
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
      if (!owner || tx.objectId !== settingsId || Object.keys(fields).length === 0 ||
        Object.keys(fields).some((key) => key !== 'enabled' && key !== 'companyDefaults') ||
        ((creating || 'enabled' in fields) && typeof fields.enabled !== 'boolean')) forbidden()
      if ('companyDefaults' in fields) {
        const defaults = fields.companyDefaults
        if (defaults === null || typeof defaults !== 'object' || Array.isArray(defaults)) forbidden()
        for (const [role, levels] of Object.entries(defaults)) {
          if ((role !== 'employee' && role !== 'supervisor' && role !== 'maintainer') || levels === null || typeof levels !== 'object' ||
            Array.isArray(levels) || Object.entries(levels).some(([alias, level]) =>
              alias.trim() === '' || (level !== 'none' && level !== 'view' && level !== 'edit'))) forbidden()
        }
      }
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
      (await this.moduleAccess(ctx, true)) ?? (() => 'none'), before ?? { extra: {}, blocked: [] }, { extra: extra as ModuleExtra, blocked })) forbidden()
  }

  private touchesDepartments (tx: Tx): boolean {
    if (tx._class === core.class.TxApplyIf) return (tx as TxApplyIf).txes.some((it) => this.touchesDepartments(it))
    return TxProcessor.isExtendsCUD(tx._class) && (tx as TxCUD<Doc>).objectClass === departmentClass
  }

  private invalidateModules (tx: Tx): void {
    if (tx._class === core.class.TxApplyIf) {
      for (const child of (tx as TxApplyIf).txes) this.invalidateModules(child)
      return
    }
    if (!TxProcessor.isExtendsCUD(tx._class)) return
    const cud = tx as TxCUD<Doc>
    if (cud.objectClass === moduleSettings) this.moduleConfiguration = undefined
    if (cud.objectClass === moduleGrant) this.grants.clear()
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    const account = ctx.contextData.account
    if (!isSystem(account, ctx)) {
      await this.load(ctx)
      for (const tx of txes) await this.check(ctx, tx)
    }
    const result = await this.provideTx(ctx, txes)
    // Space ids are written back by the sync trigger as derived transactions.
    if ([...txes, ...ctx.contextData.broadcast.txes].some((tx) => this.touchesDepartments(tx))) this.dirty = true
    this.invalidateApplicationIds([...txes, ...ctx.contextData.broadcast.txes])
    for (const tx of [...txes, ...ctx.contextData.broadcast.txes]) this.invalidateModules(tx)
    return result
  }

  private async check (ctx: MeasureContext<SessionData>, tx: Tx, newDepartments?: Set<Ref<Doc>>): Promise<void> {
    if (tx._class === core.class.TxApplyIf) {
      const pending = new Set<Ref<Doc>>()
      const children = (tx as TxApplyIf).txes
      for (const it of children) {
        await this.check(ctx, it, pending)
        if (it._class === core.class.TxCreateDoc && (it as TxCreateDoc<Doc>).objectClass === departmentClass) {
          pending.add((it as TxCreateDoc<Doc>).objectId)
        }
      }
      if (ctx.contextData.account.role === AccountRole.Maintainer && pending.size !== 0) forbidden()
      return
    }
    if (!TxProcessor.isExtendsCUD(tx._class)) return
    const cud = tx as TxCUD<Doc>
    if (cud._class === core.class.TxMixin &&
      (cud as TxMixin<Doc, Doc>).mixin === 'departments:mixin:DepartmentAutoMembers') forbidden()
    await this.checkApplicationVisibility(ctx, cud)
    await this.checkApplications(ctx, cud)
    if (cud.objectClass === moduleSettings || cud.objectClass === moduleGrant) {
      await this.checkModuleConfiguration(ctx, cud)
      return
    }
    // People can record their own audit events without permission to read tracking.
    if (cud.objectClass === auditEventClass) {
      await this.checkAudit(ctx, cud)
      return
    }
    const alias = this.protectedModule(cud.objectClass) ??
      (cud.attachedToClass === undefined ? undefined : this.protectedModule(cud.attachedToClass))
    if (alias !== undefined) {
      const level = (await this.moduleAccess(ctx))?.(alias) ?? 'edit'
      if (level === 'none' || (level === 'view' && cud.objectClass !== orderActionClass)) forbidden()
    }
    if (cud.objectClass === 'prospects:class:MailAutomation') forbidden()
    if (cud.objectClass === 'prospects:class:ProspectTemplate') {
      // The workspace upgrade creates the singleton. Editors may only replace its field definitions.
      if (cud.objectId !== 'prospects:template:Default' || cud.objectSpace !== core.space.Workspace ||
        cud._class !== core.class.TxUpdateDoc) forbidden()
      const operations = (cud as TxUpdateDoc<Doc>).operations as Record<string, unknown>
      const { fields, removedFields } = operations
      if (Object.keys(operations).some((key) => key !== 'fields' && key !== 'removedFields') ||
        !Array.isArray(fields) || !['name', 'company'].every((key) =>
          fields.filter((field) => field?.key === key).length === 1 &&
          fields.some((field) => field?.key === key && field.builtin === true && field.hidden === false)) ||
        (removedFields !== undefined && !Array.isArray(removedFields))) forbidden()
      return
    }
    if (cud.objectClass === trackingSettingsClass) {
      await this.checkAudit(ctx, cud)
      return
    }
    if (cud.objectClass === orderClass || cud.objectClass === orderActionClass || cud.objectClass === orderFlowClass) {
      await this.checkOrders(ctx, cud)
      return
    }
    if (cud.objectClass === departmentClass) {
      await this.checkDepartment(ctx, cud, newDepartments)
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

  private async checkApplicationVisibility (ctx: MeasureContext<SessionData>, tx: TxCUD<Doc>): Promise<void> {
    const account = ctx.contextData.account
    if (isOwner(account, ctx) || account.role === AccountRole.Maintainer) return
    if (!this.applicationReadClass(tx.objectClass) && tx.attachedTo === undefined) return
    const hidden = await this.hiddenApplications(ctx)
    if (hidden.size === 0) return
    const options = tx as TxCUD<Doc> & { attributes?: unknown, operations?: unknown }
    if (referencesHiddenApplication(tx, hidden) || referencesHiddenApplication(options.attributes, hidden) ||
      referencesHiddenApplication(options.operations, hidden)) forbidden()
    if (tx._class !== core.class.TxCreateDoc) {
      const existing = await this.findOne(ctx, tx.objectClass, tx.objectId)
      if (referencesHiddenApplication(existing, hidden)) forbidden()
    }
  }

  /** Applications: approved content stays fixed, steps are decided by their own approver, the applicant withdraws. */
  private async checkApplications (ctx: MeasureContext<SessionData>, tx: TxCUD<Doc>): Promise<void> {
    const account = ctx.contextData.account
    const hierarchy = this.context.hierarchy
    if (tx.objectClass === attachmentClass) {
      // Files of an approved application stay as they were approved.
      if (isOwner(account, ctx) || account.role === AccountRole.Maintainer) return
      const attachedTo =
        tx.attachedTo ??
        ((tx._class === core.class.TxCreateDoc ? undefined : await this.findOne(ctx, tx.objectClass, tx.objectId)) as any)?.attachedTo
      if (attachedTo === undefined) return
      const parent = await this.findOne(ctx, cardBaseClass as Ref<Class<Doc>>, attachedTo)
      if (parent !== undefined && (await this.applicationLocked(ctx, parent._id))) forbidden()
      return
    }
    if (tx._class !== core.class.TxUpdateDoc && tx._class !== core.class.TxMixin) return
    if (isOwner(account, ctx) || account.role === AccountRole.Maintainer) return
    const operations = ((tx as TxUpdateDoc<Doc>).operations ?? (tx as TxMixin<Doc, Doc>).attributes ?? {}) as Record<string, unknown>
    const isCard = (): boolean =>
      hierarchy.hasClass(tx.objectClass) && hierarchy.isDerived(tx.objectClass, cardBaseClass as Ref<Class<Doc>>)
    if (tx.objectClass === executionClass) {
      if (!('status' in operations)) return
      const execution = (await this.findOne(ctx, executionClass as Ref<Class<Doc>>, tx.objectId)) as (Doc & { card: Ref<Doc> }) | undefined
      const card = await this.findOne(ctx, cardBaseClass as Ref<Class<Doc>>, execution?.card)
      const applicant = card?.createdBy !== undefined && account.socialIds.includes(card.createdBy)
      if (!canChangeExecutionStatus(operations, applicant)) forbidden()
    } else if (tx.objectClass === approveRequestClass) {
      const request = (await this.findOne(ctx, approveRequestClass as Ref<Class<Doc>>, tx.objectId)) as (Doc & RequestLike) | undefined
      if (request === undefined) return
      const person = (await this.next?.findAll(ctx, 'contact:class:Person' as Ref<Class<Doc>>, { personUuid: account.uuid } as any, { limit: 1 }))?.[0]
      if (!canChangeRequest(operations, person?._id, request)) forbidden()
    } else if (touchesApplicationContent(operations) && isCard()) {
      if (await this.applicationLocked(ctx, tx.objectId)) forbidden()
    }
  }

  private async applicationLocked (ctx: MeasureContext, card: Ref<Doc>): Promise<boolean> {
    const requests = ((await this.next?.findAll(ctx, approveRequestClass as Ref<Class<Doc>>, { card, approved: true } as any)) ?? []) as unknown as Array<Doc & RequestLike>
    if (requests.length === 0) return false
    const executions = (await this.next?.findAll(ctx, executionClass as Ref<Class<Doc>>, { _id: { $in: requests.map((it) => it.execution) } } as any)) ?? []
    const cancelled = new Set<string>(executions.filter((it) => (it as any).status === 'cancelled').map((it) => it._id))
    return isApplicationLocked(requests, cancelled)
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
      if (!create || attributes.actor !== actor || attributes.auto !== undefined) forbidden()
      const order = await this.findOne(ctx, orderClass, attributes.order as Ref<Doc>)
      if (order === undefined) forbidden()
      const live = this.departments.filter((d) => !d.archived)
      const ok = canOrderAction(order as unknown as OrderLike, attributes as any, actor, owner, this.roleOf, {
        adminSomewhere: live.some((d) => d.members.admin.includes(actor)),
        departments: live.map((d) => d._id as string),
        maintainer: ctx.contextData.account.role === AccountRole.Maintainer
      })
      if (!ok) {
        if (orderPaymentBlocksAction(order as unknown as OrderLike, attributes as any)) {
          throw new PlatformError(new Status(Severity.ERROR, 'departments:string:OrderPaymentRequired' as typeof platform.status.Forbidden, {}))
        }
        forbidden()
      }
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
      const like = order as unknown as OrderLike
      const involved = like.stages.some((stage) => stage.assignee === actor ||
        departmentRoles.some((role) => role !== 'reader' && this.roleOf(stage.department, actor) === role))
      if (!canEditOrder(ops, actor, owner, like, involved)) forbidden()
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

  private async checkDepartment (ctx: MeasureContext<SessionData>, tx: TxCUD<Doc>, newDepartments?: Set<Ref<Doc>>): Promise<void> {
    const owner = isOwner(ctx.contextData.account, ctx)
    const before = this.departments.find((d) => d._id === tx.objectId)
    const account = ctx.contextData.account
    if (tx._class === core.class.TxCreateDoc) {
      if (owner) return
      const attributes = (tx as TxCreateDoc<Doc>).attributes
      if (account.role !== AccountRole.Maintainer || newDepartments === undefined ||
        tx.objectSpace !== core.space.Workspace || Object.keys(attributes).some((key) =>
          !['name', 'description', 'parent', 'teamLead', 'members', 'managers'].includes(key)) ||
        await this.findOne(ctx, departmentClass, tx.objectId) !== undefined) forbidden()
      return
    }
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
    const changedDepartment = TxProcessor.updateMixin4Doc(clone(doc) as Doc, mixinTx)
    const next = readDepartment(changedDepartment)
    if (next === undefined) forbidden()
    // Auraplex: company administrators may assign forms without gaining other department settings.
    const stored = (doc as unknown as Record<string, Record<string, unknown> | undefined>)[departmentAccessMixin]
    const updated = (changedDepartment as unknown as
      Record<string, Record<string, unknown>>)[departmentAccessMixin]
    if (JSON.stringify(stored?.applicationTypes) !== JSON.stringify(updated.applicationTypes)) {
      if (!owner && account.role !== AccountRole.Maintainer) forbidden()
      if (!Array.isArray(updated.applicationTypes) ||
        updated.applicationTypes.some((id: unknown) => typeof id !== 'string' || id === '') ||
        new Set(updated.applicationTypes).size !== updated.applicationTypes.length) forbidden()
      if (before !== undefined && Object.keys(attributes).every((key) => key === 'applicationTypes')) return
    }
    const initializing = !owner && account.role === AccountRole.Maintainer && before === undefined &&
      newDepartments?.has(tx.objectId) === true
    if (initializing) {
      newDepartments?.delete(tx.objectId)
      if (next.members.admin.length !== 1 || next.members.admin[0] !== account.uuid ||
        next.members.supervisor.length !== 0 || next.members.employee.length !== 0 || next.members.reader.length !== 0 ||
        next.autoJoin !== undefined || next.archived || next.supervisorsSeeTracking || next.employeesSeeTracking) forbidden()
    }
    const trustedConfiguration = owner || initializing
    const members: DepartmentMembers = { admin: [], supervisor: [], employee: [], reader: [] }
    const policy: DepartmentPolicy = { admin: [], supervisor: [], employee: [], reader: [] }
    const old = before ?? { members, policy, archived: false }
    if (!owner && next.archived !== old.archived) forbidden()
    // Whether supervisors see tracking is decided by super admins; staff by the department admin.
    const before2 = before ?? { supervisorsSeeTracking: false, employeesSeeTracking: false }
    if (!owner && next.supervisorsSeeTracking !== before2.supervisorsSeeTracking) forbidden()
    if (!owner && next.employeesSeeTracking !== before2.employeesSeeTracking && !(old.members.admin as string[]).includes(ctx.contextData.account.uuid)) {
      forbidden()
    }
    if (!canChangeDepartmentOptions(trustedConfiguration, old.members.admin.includes(ctx.contextData.account.uuid), before ?? {}, next)) forbidden()
    if (JSON.stringify(next.autoJoin) !== JSON.stringify(before?.autoJoin)) {
      const actor = ctx.contextData.account.uuid
      if (!owner && !old.members.admin.includes(actor)) forbidden()
      if (next.autoJoin === null || typeof next.autoJoin !== 'object' || Array.isArray(next.autoJoin)) forbidden()
      const previous = (before?.autoJoin ?? {}) as Record<string, string[]>
      for (const [alias, ids] of Object.entries(next.autoJoin)) {
        const cls = departmentAutoJoinClasses[alias] as Ref<Class<Doc>> | undefined
        if (cls === undefined || !Array.isArray(ids) || new Set(ids).size !== ids.length) forbidden()
        for (const id of ids) {
          if (typeof id !== 'string') forbidden()
          if (previous[alias]?.includes(id)) continue
          const space = await this.findOne(ctx, cls, id as Ref<Doc>) as Space | undefined
          if (space === undefined || space.archived || (!owner && !space.owners?.includes(actor))) forbidden()
        }
      }
    }
    if ((next.orderAssignee ?? null) !== (before?.orderAssignee ?? null)) {
      // The default order owner is picked by the department admins or super admins, among the members.
      if (!owner && !old.members.admin.includes(ctx.contextData.account.uuid)) forbidden()
      const value = next.orderAssignee
      if (value !== undefined && value !== null && (typeof value !== 'string' ||
        !departmentRoles.some((role) => role !== 'reader' && next.members[role].includes(value)))) forbidden()
    }
    const matrix = next.moduleAccess
    if (JSON.stringify(matrix) !== JSON.stringify(before?.moduleAccess)) {
      if (!trustedConfiguration || matrix === null || typeof matrix !== 'object' || Array.isArray(matrix)) forbidden()
      for (const [alias, row] of Object.entries(matrix)) {
        if (alias.trim() === '' || row === null || typeof row !== 'object' ||
          Object.keys(row).length !== moduleRoles.length ||
          !moduleRoles.every((role) => ['none', 'view', 'edit'].includes(row[role]))) forbidden()
      }
    }
    const ok = canChangeDepartment(
      ctx.contextData.account.uuid,
      trustedConfiguration,
      old.members,
      next.members,
      old.policy,
      next.policy
    )
    if (!ok) forbidden()
  }
}
