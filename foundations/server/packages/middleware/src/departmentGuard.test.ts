// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import core, { AccountRole, type Class, type Doc, type MeasureContext, type Ref, type SessionData, type TxCUD } from '@hcengineering/core'
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
  const inventory = 'inventory:class:Product' as Ref<Class<Doc>>
  let extra: Record<string, string> = { inventory: 'view' }
  const ctx = { contextData: { account: { uuid: 'reader', role: AccountRole.User }, broadcast: { txes: [] } } } as unknown as MeasureContext<SessionData>
  const pipeline = { hierarchy: { hasClass: () => true } } as unknown as PipelineContext
  const next = {
    findAll: jest.fn(async (_ctx, cls) => {
      if (cls === 'departments:class:ModuleSettings') return [{ enabled: true }]
      if (cls === 'departments:class:ModuleGrant') return [{ person: 'reader', extra, blocked: [] }]
      return cls === inventory ? [doc] : []
    }),
    tx: jest.fn(async () => [])
  } as unknown as Middleware
  const guard = await DepartmentGuardMiddleware.create(ctx, pipeline, next)
  const tx = { ...update({ name: 'changed' }), objectClass: inventory, objectSpace: core.space.Workspace }
  expect(await guard.findAll(ctx, inventory, {})).toEqual([doc])
  await expect(guard.tx(ctx, [tx])).rejects.toThrow()
  const ownerCtx = { contextData: { account: { uuid: 'owner', role: AccountRole.Owner }, broadcast: { txes: [] } } } as unknown as MeasureContext<SessionData>
  const grantWrite = (value: Record<string, string>) => ({
    ...update({ extra: value, blocked: [] }),
    objectClass: 'departments:class:ModuleGrant' as Ref<Class<Doc>>,
    objectId: 'departments:module-grant:reader' as Ref<Doc>,
    objectSpace: core.space.Workspace
  })
  extra = {}
  expect(await guard.findAll(ctx, inventory, {})).toEqual([doc])
  await guard.tx(ownerCtx, [grantWrite(extra)])
  expect(await guard.findAll(ctx, inventory, {})).toHaveLength(0)
  await expect(guard.tx(ctx, [tx])).rejects.toThrow()
  extra = { inventory: 'edit' }
  await guard.tx(ownerCtx, [grantWrite(extra)])
  await expect(guard.tx(ctx, [tx])).resolves.toBeDefined()
})

test('indirect queries remove blocked lookup and association targets before reading', async () => {
  const inventory = 'inventory:class:Product' as Ref<Class<Doc>>
  const contact = 'contact:class:Person' as Ref<Class<Doc>>
  const ctx = { contextData: { account: { uuid: 'reader', role: AccountRole.User } } } as unknown as MeasureContext<SessionData>
  const pipeline = {
    hierarchy: { hasClass: () => true },
    modelDb: { findObject: () => ({ classA: contact, classB: inventory }) }
  } as unknown as PipelineContext
  const row = { _id: 'contact', _class: contact, $lookup: { product: { _id: 'product', _class: inventory } } }
  const findAll = jest.fn(async (_ctx, cls, _query, _options) => {
    if (cls === 'departments:class:ModuleSettings') return [{ enabled: true }]
    if (cls === contact) return [row]
    return []
  })
  const guard = await DepartmentGuardMiddleware.create(ctx, pipeline, { findAll } as unknown as Middleware)
  const options = { lookup: { product: inventory }, associations: [['association', 1]] } as any
  const result = await guard.findAll(ctx, contact, {}, options)
  expect((result[0] as typeof row).$lookup).toEqual({})
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
        moduleAccess: { inventory: { admin: 'view', supervisor: 'none', employee: 'none', reader: 'none' } }
      } }]
      return []
    }),
    tx: jest.fn(async () => [])
  } as unknown as Middleware
  const guard = await DepartmentGuardMiddleware.create(ctx, pipeline, next)
  const create = (level: string) => ({
    _class: core.class.TxCreateDoc, objectClass: 'departments:class:ModuleGrant',
    objectId: 'departments:module-grant:worker', objectSpace: core.space.Workspace,
    attributes: { person: 'worker', extra: { inventory: level }, blocked: [] }
  }) as unknown as TxCUD<Doc>
  expect(await guard.findAll(ctx, 'inventory:class:Product' as Ref<Class<Doc>>, {})).toHaveLength(0)
  await expect(guard.tx(ctx, [create('edit')])).rejects.toThrow()
  await expect(guard.tx(ctx, [create('view')])).resolves.toBeDefined()
})
