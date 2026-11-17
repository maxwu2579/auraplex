// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import core, { type Doc, type Ref, type TxCUD } from '@hcengineering/core'
import { departmentAccessMixin, isCounterUpdate, readDepartment } from './departmentGuard'

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
