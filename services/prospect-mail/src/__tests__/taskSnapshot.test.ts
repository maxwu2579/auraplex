// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import contact from '@hcengineering/contact'
import core, { type TxOperations } from '@hcengineering/core'
import departments from '@hcengineering/departments'
import hr from '@hcengineering/hr'
import processModel from '@hcengineering/process'
import time from '@hcengineering/time'
import tracker from '@hcengineering/tracker'
import { digestRows } from '../taskDigest'
import { taskSnapshot } from '../taskSnapshot'

test('uses order stages, unfinished tracker issues and open planner items including approvals', async () => {
  const now = Date.parse('2026-11-27T00:00:00Z')
  const yesterday = now - 86_400_000
  const person = { _id: 'employee-1', personUuid: 'fake-account', active: true }
  const approval = {
    _id: 'approval-1', _class: processModel.class.ApproveRequest, user: person._id, title: 'Approve application'
  }
  const fixture = new Map([
    [departments.class.Order as string, [{
      _id: 'order-1', _class: departments.class.Order, title: 'Widget', number: 'ORD-0001',
      stages: [{ status: 'active', name: 'Design', assignee: person.personUuid, startedOn: yesterday - 1, limitDays: 1 }],
      current: 0
    }]],
    [tracker.class.Issue, [
      { _id: 'issue-1', identifier: 'TEST-1', title: 'In progress', dueDate: yesterday, status: 'open', assignee: person._id },
      { _id: 'issue-2', identifier: 'TEST-2', title: 'Finished', dueDate: yesterday, status: 'done', assignee: person._id }
    ]],
    [core.class.Status, [{ _id: 'done' }]],
    [time.class.ToDo, [{ _id: 'todo-1', _class: time.class.ToDo, user: person._id, dueDate: yesterday, title: 'Follow up' }]],
    [processModel.class.ApproveRequest, [approval]],
    [contact.class.Person, [person]],
    [hr.class.Department, []],
    [contact.class.PersonSpace, []]
  ] as Array<[string, object[]]>)
  const client = {
    findAll: jest.fn(async (key: string) => fixture.get(key) ?? []),
    getHierarchy: () => ({ hasMixin: () => true, as: (doc: unknown) => doc })
  } as unknown as TxOperations
  const base = 'https://team.test/workbench/fake-workspace'
  const snapshot = await taskSnapshot(client, base, now + 1000, true)
  expect(client.findAll).toHaveBeenCalledWith(time.class.ToDo, { doneOn: null, dueDate: { $lt: now + 1000, $gt: 0 } })
  expect(client.findAll).toHaveBeenCalledWith(processModel.class.ApproveRequest, { doneOn: null })
  const rows = digestRows(snapshot.tasks, snapshot.employees[0].personUuid!, now, now + 1000)
  expect(rows.map(({ title, section }) => [title, section])).toEqual([
    ['ORD-0001 Widget · Design', 0], ['TEST-1 In progress', 0], ['Follow up', 0], ['Approve application', 3]
  ])
  expect(rows[0].href).toContain(encodeURIComponent('departments:component:OrderPanel|order-1'))
  expect(rows[1].href).toBe(base + '/tracker/TEST-1')
  expect(rows[3].href).toContain(encodeURIComponent('time:component:EditToDo|approval-1'))
})
