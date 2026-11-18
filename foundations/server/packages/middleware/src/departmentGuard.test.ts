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
      if (cls === 'departments:class:ModuleGrant') return [{ extra, blocked: [] }]
      return cls === inventory ? [doc] : []
    }),
    tx: jest.fn(async () => [])
  } as unknown as Middleware
  const guard = await DepartmentGuardMiddleware.create(ctx, pipeline, next)
  const tx = { ...update({ name: 'changed' }), objectClass: inventory, objectSpace: core.space.Workspace }
  expect(await guard.findAll(ctx, inventory, {})).toEqual([doc])
  await expect(guard.tx(ctx, [tx])).rejects.toThrow()
  extra = {}
  expect(await guard.findAll(ctx, inventory, {})).toHaveLength(0)
  await expect(guard.tx(ctx, [tx])).rejects.toThrow()
  extra = { inventory: 'edit' }
  await expect(guard.tx(ctx, [tx])).resolves.toBeDefined()
})
