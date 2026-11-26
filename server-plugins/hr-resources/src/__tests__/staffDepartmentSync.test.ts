// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import contact from '@hcengineering/contact'
import core, { TxFactory, type PersonId, type Ref } from '@hcengineering/core'
import departments, { primaryStaffDepartments, type DepartmentAccess } from '@hcengineering/departments'
import hr, { type Department, type Staff } from '@hcengineering/hr'
import type { TriggerControl } from '@hcengineering/server-core'
import { syncDepartmentMembers, syncStaffDepartments } from '../staffDepartmentSync'

test('adding, moving and removing members produces the expected Staff mixins', async () => {
  const dep = { _id: 'a', createdOn: 1, administrators: ['new'], archived: false }
  const old = { _id: 'b', createdOn: 2, employees: ['moved', 'new'], archived: true }
  const alternative = { _id: 'c', createdOn: 3, readers: ['moved', 'same'], archived: false }
  const person = (_id: string, department?: string) => ({
    _id,
    personUuid: _id,
    _class: contact.class.Person,
    space: contact.space.Contacts,
    staff: { department }
  })
  const control = {
    txFactory: new TxFactory('system' as PersonId, true),
    hierarchy: {
      asIf: (doc: ReturnType<typeof person>, mixin: string) => (mixin === hr.mixin.Staff ? doc.staff : doc),
      hasMixin: (_doc: DepartmentAccess, mixin: string) => mixin === departments.mixin.DepartmentAccess
    },
    removedMap: new Map([['a-removed', { _id: 'a-removed' }]]),
    findAll: jest.fn(async (_ctx, cls: string) =>
      cls === hr.class.Department
        ? [old, alternative, dep]
        : [person('new'), person('moved', 'b'), person('removed', 'a-removed'), person('same', 'c')]
    )
  } as unknown as TriggerControl
  const changes = await syncStaffDepartments(control, new Set(['a', 'b', 'a-removed'] as Array<Ref<Department>>))
  expect(changes).toEqual([
    expect.objectContaining({
      _class: core.class.TxMixin,
      objectId: 'new',
      mixin: hr.mixin.Staff,
      attributes: { department: 'a' }
    }),
    expect.objectContaining({
      _class: core.class.TxMixin,
      objectId: 'moved',
      mixin: hr.mixin.Staff,
      attributes: { department: 'c' }
    }),
    expect.objectContaining({
      _class: core.class.TxMixin,
      objectId: 'removed',
      mixin: hr.mixin.Staff,
      attributes: { department: null }
    })
  ])
})

test('primary departments are deterministic across roles, and archived departments never win', () => {
  const fixture = [
    { _id: 'new', createdOn: 5, administrators: ['staff'] },
    { _id: 'old', createdOn: 3, supervisors: ['staff'], readers: ['guest'] },
    { _id: 'archived', createdOn: 1, archived: true, employees: ['staff', 'archived-only'] }
  ] as unknown as DepartmentAccess[]
  expect([...primaryStaffDepartments(fixture)]).toEqual([
    ['staff', 'old'],
    ['guest', 'old']
  ])
  expect([...primaryStaffDepartments(fixture.slice().reverse())]).toEqual([
    ['staff', 'old'],
    ['guest', 'old']
  ])
})

test('reconciles calendar membership from the stored Staff department and retains shared ancestors', async () => {
  const department = (_id: string, members: string[], parent?: string) => ({
    _id,
    space: core.space.Workspace,
    parent,
    members
  })
  const record = { _id: 'employee', department: 'next' as string | null }
  const control = {
    txFactory: new TxFactory('system' as PersonId, true),
    findAll: jest.fn(async (_ctx, cls: string) =>
      cls === hr.class.Department
        ? [department('head', ['employee']), department('old', ['employee'], 'head'), department('next', [], 'head')]
        : [record]
    )
  } as unknown as TriggerControl
  const ids = new Set(['employee' as Ref<Staff>])
  expect(await syncDepartmentMembers(control, ids)).toEqual([
    expect.objectContaining({ objectId: 'old', operations: { $pull: { members: 'employee' } } }),
    expect.objectContaining({ objectId: 'next', operations: { $push: { members: 'employee' } } })
  ])
  record.department = null
  expect(await syncDepartmentMembers(control, ids)).toEqual([
    expect.objectContaining({ objectId: 'head', operations: { $pull: { members: 'employee' } } }),
    expect.objectContaining({ objectId: 'old', operations: { $pull: { members: 'employee' } } })
  ])
})
