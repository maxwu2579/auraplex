// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import card from '@hcengineering/card'
import contact from '@hcengineering/contact'
import core, { TxFactory, type PersonId, type Ref, type TxUpdateDoc } from '@hcengineering/core'
import hr from '@hcengineering/hr'
import process, { ExecutionStatus, type Execution } from '@hcengineering/process'
import type { TriggerControl } from '@hcengineering/server-core'
import { OnHrCalendar } from '../hrCalendar'

function fixture (status = ExecutionStatus.Done, approved = true) {
  const execution = { _id: 'execution', card: 'application', process: 'leave', status }
  const application = {
    _id: 'application',
    createdBy: 'submitter',
    title: 'Synthetic leave',
    start: Date.UTC(2026, 10, 27),
    end: Date.UTC(2026, 10, 30),
    kind: '年假'
  }
  const records = new Map<string, unknown[]>([
    [process.class.Execution, [execution]],
    [process.class.ApproveRequest, [{ approved, doneOn: 1 }]],
    [card.class.Card, [application]],
    [contact.class.SocialIdentity, [{ attachedTo: 'employee' }]],
    [hr.mixin.Staff, [{ _id: 'employee', _class: contact.class.Person, department: 'department' }]]
  ])
  const control = {
    txFactory: new TxFactory('system' as PersonId, true),
    findAll: jest.fn(async (_ctx, cls: string) => records.get(cls) ?? []),
    modelDb: { findObject: () => ({ hrCalendar: { start: 'start', end: 'end', kind: 'kind' } }) },
    workspace: { url: 'synthetic' },
    branding: { front: 'https://example.test' }
  } as unknown as TriggerControl
  const tx = control.txFactory.createTxUpdateDoc(
    process.class.Execution,
    core.space.Workspace,
    'execution' as Ref<Execution>,
    { status }
  )
  return { control, records, tx, execution, application }
}

test('approved card creates one linked calendar request with inclusive calendar dates', async () => {
  const { control, tx } = fixture()
  const result = await OnHrCalendar([tx, tx], control)
  expect(result).toEqual([
    expect.objectContaining({
      _class: core.class.TxCreateDoc,
      objectClass: hr.class.Request,
      objectId: 'application-leave:application',
      attachedTo: 'employee',
      attachedToClass: contact.class.Person,
      collection: 'requests',
      attributes: expect.objectContaining({
        department: 'department',
        type: hr.ids.Vacation,
        tzDate: { year: 2026, month: 10, day: 27, offset: 0 },
        tzDueDate: { year: 2026, month: 10, day: 30, offset: 0 },
        description: expect.stringContaining('https://example.test/workbench/synthetic/card/application')
      })
    })
  ])
})

test('rejecting or withdrawing without an existing request does not add leave', async () => {
  for (const setup of [fixture(ExecutionStatus.Done, false), fixture(ExecutionStatus.Cancelled)]) {
    expect(await OnHrCalendar([setup.tx], setup.control)).toEqual([])
  }
})

test('approval replay leaves a persisted request alone, cancellation removes it once', async () => {
  const setup = fixture()
  const stored = {
    _id: 'application-leave:application',
    space: core.space.Workspace,
    attachedTo: 'employee',
    attachedToClass: contact.class.Person
  }
  setup.records.set(hr.class.Request, [stored])
  expect(await OnHrCalendar([setup.tx], setup.control)).toEqual([])
  setup.execution.status = ExecutionStatus.Cancelled
  setup.tx.operations.status = ExecutionStatus.Cancelled
  expect(await OnHrCalendar([setup.tx, setup.tx], setup.control)).toEqual([
    expect.objectContaining({
      _class: core.class.TxRemoveDoc,
      objectClass: hr.class.Request,
      objectId: stored._id,
      attachedTo: 'employee'
    })
  ])
})

test('a completion that no longer reflects the persisted state cannot recreate cancelled leave', async () => {
  const { control, execution, tx } = fixture()
  execution.status = ExecutionStatus.Cancelled
  expect(await OnHrCalendar([tx], control)).toEqual([])
})

test('unanswered approval steps and inverted dates do not create a request', async () => {
  const setup = fixture()
  setup.records.set(process.class.ApproveRequest, [{ approved: true, doneOn: 1 }, { doneOn: null }])
  expect(await OnHrCalendar([setup.tx], setup.control)).toEqual([])
  setup.records.set(process.class.ApproveRequest, [{ approved: true, doneOn: 1 }])
  setup.application.end = setup.application.start - 1
  expect(await OnHrCalendar([setup.tx], setup.control)).toEqual([])
})
