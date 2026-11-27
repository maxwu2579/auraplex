// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import core, { AccountRole, type Class, type Doc, type MeasureContext, type OperationDomain, type Ref, type SessionData, type TxCUD } from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { DepartmentGuardMiddleware, departmentAccessMixin, isCounterUpdate, readDepartment } from './departmentGuard'

const update = (operations: Record<string, unknown>): TxCUD<Doc> =>
  ({ _class: core.class.TxUpdateDoc, operations }) as unknown as TxCUD<Doc>

test('only the issue counter may be bumped on a department space', () => {
  expect(isCounterUpdate(update({ $inc: { sequence: 1 } }))).toBe(true)
  expect(isCounterUpdate(update({ members: ['x'] }))).toBe(false)
  expect(isCounterUpdate(update({ $inc: { sequence: 1 }, name: 'x' }))).toBe(false)
  expect(isCounterUpdate(update({ $inc: { other: 1 } }))).toBe(false)
  expect(isCounterUpdate({ _class: core.class.TxMixin } as unknown as TxCUD<Doc>)).toBe(false)
})

test('reads department access from the stored mixin and ignores garbage', () => {
  const doc = {
    _id: 'd' as Ref<Doc>,
    [departmentAccessMixin]: {
      administrators: ['a'],
      supervisors: ['s', 3],
      employees: 'not a list',
      readerPermissions: ['comment'],
      adminPermissions: ['create', 'delete'],
      projectSpace: 'p1',
      driveSpace: 'p3',
      archived: true
    }
  } as unknown as Doc
  const record = readDepartment(doc)
  expect(record?.members).toEqual({ admin: ['a'], supervisor: ['s'], employee: [], reader: [] })
  expect(record?.policy.admin).toEqual(['create', 'delete'])
  expect(record?.policy.reader).toEqual(['comment'])
  expect(record?.spaces).toEqual(['p1', 'p3'])
  expect(record?.archived).toBe(true)
  expect(readDepartment({ _id: 'x' } as unknown as Doc)).toBeUndefined()
})

test('module guard rejects view writes and none queries, and reads refreshed grants', async () => {
  const doc = { _id: 'product' } as Doc
  const materials = 'materials:class:Product' as Ref<Class<Doc>>
  let extra: Record<string, string> = { materials: 'view' }
  const ctx = { contextData: { account: { uuid: 'reader', role: AccountRole.User }, broadcast: { txes: [] } } } as unknown as MeasureContext<SessionData>
  const pipeline = { hierarchy: { hasClass: () => true } } as unknown as PipelineContext
  const next = {
    findAll: jest.fn(async (_ctx, cls) => {
      if (cls === 'departments:class:ModuleSettings') return [{ enabled: true }]
      if (cls === 'departments:class:ModuleGrant') return [{ person: 'reader', extra, blocked: [] }]
      return cls === materials ? [doc] : []
    }),
    tx: jest.fn(async () => [])
  } as unknown as Middleware
  const guard = await DepartmentGuardMiddleware.create(ctx, pipeline, next)
  const tx = { ...update({ name: 'changed' }), objectClass: materials, objectSpace: core.space.Workspace }
  expect(await guard.findAll(ctx, materials, {})).toEqual([doc])
  await expect(guard.tx(ctx, [tx])).rejects.toThrow()
  const ownerCtx = { contextData: { account: { uuid: 'owner', role: AccountRole.Owner }, broadcast: { txes: [] } } } as unknown as MeasureContext<SessionData>
  const grantWrite = (value: Record<string, string>) => ({
    ...update({ extra: value, blocked: [] }),
    objectClass: 'departments:class:ModuleGrant' as Ref<Class<Doc>>,
    objectId: 'departments:module-grant:reader' as Ref<Doc>,
    objectSpace: core.space.Workspace
  })
  extra = {}
  expect(await guard.findAll(ctx, materials, {})).toEqual([doc])
  await guard.tx(ownerCtx, [grantWrite(extra)])
  expect(await guard.findAll(ctx, materials, {})).toHaveLength(0)
  await expect(guard.tx(ctx, [tx])).rejects.toThrow()
  extra = { materials: 'edit' }
  await guard.tx(ownerCtx, [grantWrite(extra)])
  await expect(guard.tx(ctx, [tx])).resolves.toBeDefined()
})

test('indirect queries remove blocked lookup and association targets before reading', async () => {
  const materials = 'materials:class:Product' as Ref<Class<Doc>>
  const contact = 'contact:class:Person' as Ref<Class<Doc>>
  const ctx = { contextData: { account: { uuid: 'reader', role: AccountRole.User } } } as unknown as MeasureContext<SessionData>
  const pipeline = {
    hierarchy: { hasClass: () => true },
    modelDb: { findObject: () => ({ classA: contact, classB: materials }) }
  } as unknown as PipelineContext
  const row = { _id: 'contact', _class: contact, $lookup: { product: { _id: 'product', _class: materials } } }
  const findAll = jest.fn(async (_ctx, cls, _query, _options) => {
    if (cls === 'departments:class:ModuleSettings') return [{ enabled: true }]
    if (cls === contact) return [row]
    return []
  })
  const guard = await DepartmentGuardMiddleware.create(ctx, pipeline, { findAll } as unknown as Middleware)
  const options = { lookup: { product: materials }, associations: [['association', 1]] } as any
  const result = await guard.findAll(ctx, contact, {}, options)
  expect((result[0] as unknown as typeof row).$lookup).toEqual({})
  expect(findAll).toHaveBeenLastCalledWith(ctx, contact, {}, { lookup: {}, associations: [] })
  expect(await guard.findAll(ctx, contact, { '$lookup.product.name': 'secret' } as any, options)).toHaveLength(0)
})

test('tracking access is required for reads but not for writing your own audit events', async () => {
  const audit = 'departments:class:AuditEvent' as Ref<Class<Doc>>
  const ctx = { contextData: { account: { uuid: 'worker', role: AccountRole.User }, broadcast: { txes: [] } } } as unknown as MeasureContext<SessionData>
  const pipeline = { hierarchy: { hasClass: () => true } } as unknown as PipelineContext
  const next = {
    findAll: jest.fn(async (_ctx, cls) => cls === 'departments:class:ModuleSettings' ? [{ enabled: true }] : []),
    tx: jest.fn(async () => [])
  } as unknown as Middleware
  const guard = await DepartmentGuardMiddleware.create(ctx, pipeline, next)
  const create = (actor: string, kind: string) => ({
    _class: core.class.TxCreateDoc, objectClass: audit, objectSpace: core.space.Workspace,
    attributes: { actor, kind, count: 1 }
  }) as unknown as TxCUD<Doc>
  await expect(guard.tx(ctx, [create('worker', 'view'), create('worker', 'export')])).resolves.toBeDefined()
  await expect(guard.tx(ctx, [create('somebody-else', 'view')])).rejects.toThrow()
  expect(await guard.findAll(ctx, audit, {})).toHaveLength(0)
})

test('module grants keep the department administrator ceiling while module control is disabled', async () => {
  const ctx = { contextData: { account: { uuid: 'admin', role: AccountRole.User }, broadcast: { txes: [] } } } as unknown as MeasureContext<SessionData>
  const pipeline = { hierarchy: { hasClass: () => true } } as unknown as PipelineContext
  const next = {
    findAll: jest.fn(async (_ctx, cls) => {
      if (cls === 'departments:class:ModuleSettings') return [{ enabled: false }]
      if (cls === 'hr:class:Department') return [{ _id: 'sales', [departmentAccessMixin]: {
        administrators: ['admin'], employees: ['worker'],
        moduleAccess: { materials: { admin: 'view', supervisor: 'none', employee: 'none', reader: 'none' } }
      } }]
      return []
    }),
    tx: jest.fn(async () => [])
  } as unknown as Middleware
  const guard = await DepartmentGuardMiddleware.create(ctx, pipeline, next)
  const create = (level: string) => ({
    _class: core.class.TxCreateDoc, objectClass: 'departments:class:ModuleGrant',
    objectId: 'departments:module-grant:worker', objectSpace: core.space.Workspace,
    attributes: { person: 'worker', extra: { materials: level }, blocked: [] }
  }) as unknown as TxCUD<Doc>
  expect(await guard.findAll(ctx, 'materials:class:Product' as Ref<Class<Doc>>, {})).toHaveLength(0)
  await expect(guard.tx(ctx, [create('edit')])).rejects.toThrow()
  await expect(guard.tx(ctx, [create('view')])).resolves.toBeDefined()
})

test('department auto join can only be configured by authorized admins for a matching space', async () => {
  const departmentClass = 'hr:class:Department' as Ref<Class<Doc>>
  const department = {
    _id: 'dept', _class: departmentClass, space: core.space.Workspace,
    [departmentAccessMixin]: { administrators: ['admin'], employees: ['worker'] }
  }
  const pipeline = { hierarchy: { hasClass: () => true } } as unknown as PipelineContext
  const next = {
    findAll: jest.fn(async (_ctx, cls) => {
      if (cls === departmentClass) return [department]
      if (cls === 'tracker:class:Project') return [{ _id: 'project', owners: ['admin'], private: true }]
      return []
    }),
    tx: jest.fn(async () => [])
  } as unknown as Middleware
  const context = (uuid: string) => ({ contextData: { account: { uuid, role: AccountRole.User }, broadcast: { txes: [] } } }) as unknown as MeasureContext<SessionData>
  const guard = await DepartmentGuardMiddleware.create(context('admin'), pipeline, next)
  const tx = (alias: string) => ({
    _class: core.class.TxMixin, objectClass: departmentClass, objectId: department._id,
    objectSpace: department.space, mixin: departmentAccessMixin, attributes: { autoJoin: { [alias]: ['project'] } }
  }) as unknown as TxCUD<Doc>
  await expect(guard.tx(context('worker'), [tx('tracker')])).rejects.toThrow()
  await expect(guard.tx(context('admin'), [tx('drive')])).rejects.toThrow()
  await expect(guard.tx(context('admin'), [tx('tracker')])).resolves.toBeDefined()
})

test('blocked WhatsApp messages are hidden and writes are rejected before reaching downstream guards', async () => {
  const messageClass = 'whatsapp:class:Message' as Ref<Class<Doc>>
  const ctx = { contextData: { account: { uuid: 'worker', role: AccountRole.User }, broadcast: { txes: [] } } } as unknown as MeasureContext<SessionData>
  const pipeline = { hierarchy: { hasClass: () => true } } as unknown as PipelineContext
  const findAll = jest.fn(async (_ctx, cls) => {
    if (cls === 'departments:class:ModuleSettings') return [{ enabled: true }]
    if (cls === 'departments:class:ModuleGrant') return [{ extra: {}, blocked: ['whatsapp'] }]
    return []
  })
  const tx = jest.fn(async () => [])
  const guard = await DepartmentGuardMiddleware.create(ctx, pipeline, { findAll, tx } as unknown as Middleware)
  expect(await guard.findAll(ctx, messageClass, {})).toHaveLength(0)
  expect(findAll.mock.calls.some(([, cls]) => cls === messageClass)).toBe(false)
  const write = { ...update({}), objectClass: messageClass, objectSpace: core.space.Workspace }
  await expect(guard.tx(ctx, [write])).rejects.toThrow()
  expect(tx).not.toHaveBeenCalled()
})

test('workspace administrators can create departments with themselves as the only initial admin', async () => {
  const dept = 'hr:class:Department' as Ref<Class<Doc>>
  const id = 'new-department' as Ref<Doc>
  const ctx = (role: AccountRole) => ({ contextData: { account: { uuid: 'creator', role }, broadcast: { txes: [] } } }) as unknown as MeasureContext<SessionData>
  const pipeline = { hierarchy: { hasClass: () => true } } as unknown as PipelineContext
  const next = { findAll: jest.fn(async () => []), tx: jest.fn(async () => []) } as unknown as Middleware
  const guard = await DepartmentGuardMiddleware.create(ctx(AccountRole.Maintainer), pipeline, next)
  const target = { objectClass: dept, objectId: id, objectSpace: core.space.Workspace }
  const create = { ...target, _class: core.class.TxCreateDoc, attributes: { name: '测试部门' } }
  const mixin = (admin: string) => ({ ...target, _class: core.class.TxMixin, mixin: departmentAccessMixin, attributes: {
    administrators: [admin], supervisors: [], employees: [], readers: [],
    adminPermissions: ['manageMembers'], supervisorPermissions: [], employeePermissions: [], readerPermissions: []
  } })
  const batch = (...txes: unknown[]) => ({ _class: core.class.TxApplyIf, txes }) as unknown as TxCUD<Doc>
  await expect(guard.tx(ctx(AccountRole.Maintainer), [batch(create, mixin('creator'))])).resolves.toBeDefined()
  await expect(guard.tx(ctx(AccountRole.Maintainer), [batch(create, mixin('other'))])).rejects.toThrow()
  await expect(guard.tx(ctx(AccountRole.Maintainer), [batch(create)])).rejects.toThrow()
  await expect(guard.tx(ctx(AccountRole.Maintainer), [batch(mixin('creator'))])).rejects.toThrow()
  await expect(guard.tx(ctx(AccountRole.User), [batch(create, mixin('creator'))])).rejects.toThrow()
  await expect(guard.tx(ctx(AccountRole.Owner), [batch(create, mixin('other'))])).resolves.toBeDefined()
})

test('only owners can save validated company module defaults', async () => {
  const cls = 'departments:class:ModuleSettings' as Ref<Class<Doc>>
  const ctx = (role: AccountRole) => ({ contextData: { account: { uuid: 'tester', role }, broadcast: { txes: [] } } }) as unknown as MeasureContext<SessionData>
  const next = { findAll: jest.fn(async () => []), tx: jest.fn(async () => []) } as unknown as Middleware
  const guard = await DepartmentGuardMiddleware.create(ctx(AccountRole.Owner), { hierarchy: { hasClass: () => true } } as unknown as PipelineContext, next)
  const change = (companyDefaults: unknown) => ({ ...update({ companyDefaults }),
    objectClass: cls, objectId: 'departments:ids:ModuleSettings' as Ref<Doc>, objectSpace: core.space.Workspace })
  await expect(guard.tx(ctx(AccountRole.Owner), [change({ employee: { document: 'edit' } })])).resolves.toBeDefined()
  await expect(guard.tx(ctx(AccountRole.Maintainer), [change({ employee: { document: 'edit' } })])).rejects.toThrow()
  await expect(guard.tx(ctx(AccountRole.Owner), [change({ guest: { document: 'edit' } })])).rejects.toThrow()
  await expect(guard.tx(ctx(AccountRole.Owner), [change({ employee: { document: 'all' } })])).rejects.toThrow()
})

test('only department admins pick the default order owner, and only among the members', async () => {
  const departmentClass = 'hr:class:Department' as Ref<Class<Doc>>
  const department = {
    _id: 'dept', _class: departmentClass, space: core.space.Workspace,
    [departmentAccessMixin]: { administrators: ['admin'], supervisors: ['lead'], employees: ['worker'] }
  }
  const pipeline = { hierarchy: { hasClass: () => true } } as unknown as PipelineContext
  const next = {
    findAll: jest.fn(async (_ctx, cls) => (cls === departmentClass ? [department] : [])),
    tx: jest.fn(async () => [])
  } as unknown as Middleware
  const context = (uuid: string) => ({ contextData: { account: { uuid, role: AccountRole.User }, broadcast: { txes: [] } } }) as unknown as MeasureContext<SessionData>
  const guard = await DepartmentGuardMiddleware.create(context('admin'), pipeline, next)
  const tx = (orderAssignee: string | null) => ({
    _class: core.class.TxMixin, objectClass: departmentClass, objectId: department._id,
    objectSpace: department.space, mixin: departmentAccessMixin, attributes: { orderAssignee }
  }) as unknown as TxCUD<Doc>
  await expect(guard.tx(context('worker'), [tx('lead')])).rejects.toThrow()
  await expect(guard.tx(context('admin'), [tx('stranger')])).rejects.toThrow()
  await expect(guard.tx(context('admin'), [tx('lead')])).resolves.toBeDefined()
  await expect(guard.tx(context('admin'), [tx(null)])).resolves.toBeDefined()
})

test('a department administrator cannot assign application forms; a company maintainer can', async () => {
  const cls = 'hr:class:Department' as Ref<Class<Doc>>
  const department = { _id: 'dept', _class: cls, space: core.space.Workspace,
    [departmentAccessMixin]: { administrators: ['department-admin'] } }
  const context = (role: AccountRole) => ({
    contextData: { account: { uuid: 'department-admin', role }, broadcast: { txes: [] } }
  }) as unknown as MeasureContext<SessionData>
  const pipeline = { hierarchy: { hasClass: () => true } } as unknown as PipelineContext
  const next = {
    findAll: async (_ctx: unknown, objectClass: string) => objectClass === cls ? [department] : [],
    tx: async () => []
  } as unknown as Middleware
  const guard = await DepartmentGuardMiddleware.create(context(AccountRole.User), pipeline, next)
  const tx = { _class: core.class.TxMixin, mixin: departmentAccessMixin, objectClass: cls,
    objectSpace: core.space.Workspace, objectId: 'dept',
    attributes: { applicationTypes: ['fake:class:Leave'] } } as unknown as TxCUD<Doc>
  await expect(guard.tx(context(AccountRole.User), [tx])).rejects.toThrow()
  await expect(guard.tx(context(AccountRole.Maintainer), [tx])).resolves.toBeDefined()
})

test('application reads and writes respect department, author and historical approval visibility', async () => {
  const card = 'card:class:Card'
  const leave = 'test:class:Leave'
  const expense = 'test:class:Expense'
  const comment = 'activity:class:ActivityMessage'
  const approval = 'process:class:ApproveRequest'
  const execution = 'process:class:Execution'
  const process = 'process:class:Process'
  const person = 'contact:class:Person'
  const dept = 'hr:class:Department'
  const inbox = 'notification:class:InboxNotification'
  let archived = false
  const cards = [
    { _id: 'peer-leave', _class: leave, createdBy: 'peer' },
    { _id: 'own-leave', _class: leave, createdBy: 'worker' },
    { _id: 'peer-expense', _class: expense, createdBy: 'peer' },
    { _id: 'normal-card', _class: card, createdBy: 'peer' }
  ]
  const request = { _id: 'req', _class: approval, user: 'new-approver', card: 'peer-expense' }
  const run = { _id: 'run', _class: execution, card: 'peer-expense' }
  const context = (uuid: string, role = AccountRole.User) => ({
    contextData: { account: { uuid, role, socialIds: [uuid] }, broadcast: { txes: [] } }
  }) as unknown as MeasureContext<SessionData>
  const findAll = jest.fn(async (_ctx, cls, query = {}, options = {}) => {
    if (cls === dept) return [{ _id: 'production', _class: dept, space: core.space.Workspace,
      [departmentAccessMixin]: { administrators: ['admin'], supervisors: ['lead'], employees: ['worker'],
        applicationTypes: [leave], archived } }]
    if (cls === process) return [{ masterTag: leave }, { masterTag: expense }]
    if (cls === card) {
      const rows = query._class === undefined ? cards : cards.filter((row) => query._class.$in.includes(row._class))
      return rows.slice(0, options.limit ?? rows.length)
    }
    if (cls === comment) return [{ _id: 'private-comment', _class: comment, attachedTo: 'peer-leave' }]
    if (cls === person) return [{ _id: query.personUuid }]
    if (cls === approval) return query.user === undefined || query.user === 'new-approver' ? [request] : []
    if (cls === execution) return [run]
    if (cls === inbox) return [
      { _id: 'private-notice', _class: inbox, objectId: 'peer-leave' },
      { _id: 'own-notice', _class: inbox, objectId: 'own-leave' }
    ]
    if (cls === core.class.TxCreateDoc && query['attributes.user'] === 'old-approver') return [{ objectId: 'req' }]
    return []
  })
  const hierarchy = { hasClass: () => true, isMixin: () => false, hasMixin: () => true,
    getClass: () => ({}), getDescendants: () => [], isDerived: (cls: string, base: string) =>
      cls === base || (base === card && (cls === leave || cls === expense)) }
  const next = {
    findAll,
    domainRequest: jest.fn(async (_ctx, domain) => ({
      domain, value: [{ cardId: 'peer-leave' }, { cardId: 'own-leave' }]
    })),
    searchFulltext: async () => ({
      docs: [
        { doc: cards[0], id: cards[0]._id, title: 'Private test application' },
        { doc: cards[1], id: cards[1]._id, title: 'Own test application' },
        { doc: { _id: 'message', _class: comment, attachedTo: cards[0]._id }, id: 'message' }
      ],
      total: 3
    }),
    tx: async () => []
  } as unknown as Middleware
  const guard = await DepartmentGuardMiddleware.create(context('worker'), { hierarchy } as unknown as PipelineContext, next)
  const read = async (actor: string, role = AccountRole.User) =>
    await guard.findAll(context(actor, role), card as Ref<Class<Doc>>, {}, { limit: 1, total: true })
  const own = await read('worker')
  expect(own.map((row) => row._id)).toEqual(['own-leave'])
  expect(own.total).toBe(2)
  expect((await read('admin')).total).toBe(3)
  expect((await read('lead')).total).toBe(3)
  expect((await read('outsider')).map((row) => row._id)).toEqual(['normal-card'])
  for (const actor of ['old-approver', 'new-approver']) {
    expect((await read(actor)).map((row) => row._id)).toEqual(['peer-expense'])
    expect(await guard.findAll(context(actor), execution as Ref<Class<Doc>>, {})).toHaveLength(1)
  }
  expect(await guard.findAll(context('worker'), approval as Ref<Class<Doc>>, {})).toHaveLength(0)
  expect(await guard.findAll(context('worker'), comment as Ref<Class<Doc>>, {})).toHaveLength(0)
  const notices = await guard.findAll(context('worker'), inbox as Ref<Class<Doc>>, {})
  expect(notices.map((notice) => notice._id)).toEqual(['own-notice'])
  expect(notices.total).toBe(1)
  const search = await guard.searchFulltext(context('worker'), { query: 'test' }, {})
  expect(search.docs.map((hit) => hit.id)).toEqual(['own-leave'])
  expect(search.total).toBe(1)
  for (const role of [AccountRole.Owner, AccountRole.Maintainer]) {
    expect((await read('company-admin', role))[0]?._id).toBe('peer-leave')
  }
  const write = { _class: core.class.TxCreateDoc, objectClass: comment, objectSpace: core.space.Workspace,
    objectId: 'comment', attachedTo: 'peer-leave', attributes: {} } as unknown as TxCUD<Doc>
  await expect(guard.tx(context('worker'), [write])).rejects.toThrow()
  const communication = 'communication' as OperationDomain
  const list = await guard.domainRequest(context('worker'), communication, { findNotifications: { params: {} } })
  expect(list.value).toEqual([{ cardId: 'own-leave' }])
  const messages = await guard.domainRequest(context('worker'), communication, {
    findMessagesMeta: { params: { cardId: 'peer-leave' } }
  })
  expect(messages.value).toEqual([])
  await expect(guard.domainRequest(context('worker'), communication, { event: { cardId: 'peer-leave' } })).rejects.toThrow()
  expect((await guard.domainRequest(context('worker'), communication, {
    subscribeCard: { cardId: 'peer-leave' }
  })).value).toBeUndefined()
  expect((await guard.domainRequest(context('worker'), communication, {
    filterApplicationBroadcast: [{ cardId: 'peer-leave' }, { cardId: 'own-leave' }]
  })).value).toEqual([{ cardId: 'own-leave' }])
  const previousCalls = findAll.mock.calls.filter(([, cls]) => cls === process).length
  await read('admin')
  expect(findAll.mock.calls.filter(([, cls]) => cls === process)).toHaveLength(previousCalls)
  archived = true
  const archive = { ...update({}), objectClass: dept, objectId: 'production' as Ref<Doc>, objectSpace: core.space.Workspace }
  await guard.tx(context('owner', AccountRole.Owner), [archive])
  expect((await read('admin')).map((row) => row._id)).toEqual(['normal-card'])
})

test('prospect template writes require edit access and cannot hide either identity field', async () => {
  const cls = 'prospects:class:ProspectTemplate' as Ref<Class<Doc>>
  const ctx = { contextData: { account: { uuid: 'reader', role: AccountRole.User }, broadcast: { txes: [] } } } as unknown as MeasureContext<SessionData>
  const pipeline = { hierarchy: { hasClass: () => true } } as unknown as PipelineContext
  const next = {
    findAll: jest.fn(async (_ctx, cls) => {
      if (cls === 'departments:class:ModuleSettings') return [{ enabled: true }]
      if (cls === 'departments:class:ModuleGrant') return [{ extra: { prospects: 'view' }, blocked: [] }]
      return []
    }),
    tx: jest.fn(async () => [])
  } as unknown as Middleware
  const guard = await DepartmentGuardMiddleware.create(ctx, pipeline, next)
  const tx = (hidden: boolean) => ({
    ...update({ fields: [{ key: 'name', builtin: true, hidden }, { key: 'company', builtin: true, hidden: false }] }),
    objectClass: cls,
    objectSpace: core.space.Workspace,
    objectId: 'prospects:template:Default' as Ref<Doc>
  })
  await expect(guard.tx(ctx, [tx(false)])).rejects.toThrow()
  expect(next.tx).not.toHaveBeenCalled()

  const owner = { contextData: { account: { uuid: 'owner', role: AccountRole.Owner }, broadcast: { txes: [] } } } as unknown as MeasureContext<SessionData>
  await expect(guard.tx(owner, [tx(true)])).rejects.toThrow()
  await expect(guard.tx(owner, [tx(false)])).resolves.toBeDefined()
})
