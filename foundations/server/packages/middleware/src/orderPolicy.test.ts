// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { type DepartmentRole } from './departmentPolicy'
import { canChangeFlow, canCreateOrder, canEditOrder, canOrderAction, type OrderLike, type RoleOf } from './orderPolicy'

// sales: Wang (employee); production: Ming (admin), Qiang (supervisor), Li (employee), Wang reader
const roles: Record<string, Record<string, DepartmentRole>> = {
  sales: { wang: 'employee' },
  production: { ming: 'admin', qiang: 'supervisor', li: 'employee', zhao: 'reader' }
}
const roleOf: RoleOf = (department, person) => (department === undefined ? undefined : roles[department]?.[person])

const order = (): OrderLike => ({
  salesOwner: 'wang',
  current: 1,
  state: 'active',
  stages: [
    { id: 's', department: 'sales', status: 'done', steps: [] },
    { id: 'p', department: 'production', status: 'active', assignee: 'li', steps: [{ name: '切割', done: false }] },
    { id: 'e', department: 'engineering', status: 'waiting', steps: [] }
  ]
})

test('the person in charge finishes their stage; others in the department cannot', () => {
  expect(canOrderAction(order(), { kind: 'complete', stage: 'p' }, 'li', false, roleOf)).toBe(true)
  expect(canOrderAction(order(), { kind: 'complete', stage: 'p' }, 'qiang', false, roleOf)).toBe(true)
  expect(canOrderAction(order(), { kind: 'complete', stage: 'p' }, 'zhao', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), { kind: 'complete', stage: 'p' }, 'wang', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), { kind: 'complete', stage: 'e' }, 'li', false, roleOf)).toBe(false)
})

test('supervisors assign people of their own department only', () => {
  expect(canOrderAction(order(), { kind: 'assign', stage: 'p', assignee: 'li' }, 'qiang', false, roleOf)).toBe(true)
  expect(canOrderAction(order(), { kind: 'assign', stage: 'p', assignee: 'zhao' }, 'qiang', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), { kind: 'assign', stage: 'p', assignee: 'wang' }, 'qiang', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), { kind: 'assign', stage: 'p', assignee: 'li' }, 'li', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), { kind: 'assign', stage: 's', assignee: 'wang' }, 'qiang', false, roleOf)).toBe(false)
})

test('staff escalate with a reason; only supervisors return, to an earlier stage', () => {
  expect(canOrderAction(order(), { kind: 'escalate', stage: 'p', reason: '图纸有问题' }, 'li', false, roleOf)).toBe(true)
  expect(canOrderAction(order(), { kind: 'escalate', stage: 'p', reason: ' ' }, 'li', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), { kind: 'return', stage: 'p', target: 's', reason: '价格' }, 'li', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), { kind: 'return', stage: 'p', target: 's', reason: '价格' }, 'qiang', false, roleOf)).toBe(true)
  expect(canOrderAction(order(), { kind: 'return', stage: 'p', target: 'e', reason: '价格' }, 'qiang', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), { kind: 'return', stage: 'p', target: 's' }, 'qiang', false, roleOf)).toBe(false)
})

test('steps are ticked by the person in charge; finished orders are frozen; super admins can do all', () => {
  expect(canOrderAction(order(), { kind: 'step', stage: 'p', step: 0 }, 'li', false, roleOf)).toBe(true)
  expect(canOrderAction(order(), { kind: 'step', stage: 'p', step: 3 }, 'li', false, roleOf)).toBe(false)
  expect(canOrderAction({ ...order(), state: 'done' }, { kind: 'complete', stage: 'p' }, 'li', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), { kind: 'return', stage: 'p', target: 's', reason: 'x' }, 'boss', true, roleOf)).toBe(true)
})

test('orders are created by working members for themselves, without stages', () => {
  expect(canCreateOrder({ salesOwner: 'wang', title: 'A' }, 'wang', false, true)).toBe(true)
  expect(canCreateOrder({ salesOwner: 'li', title: 'A' }, 'wang', false, true)).toBe(false)
  expect(canCreateOrder({ salesOwner: 'wang' }, 'wang', false, false)).toBe(false)
  expect(canCreateOrder({ salesOwner: 'wang', stages: [{ id: 'x' }] }, 'wang', false, true)).toBe(false)
  expect(canEditOrder({ title: 'B' }, 'wang', false, order())).toBe(true)
  expect(canEditOrder({ stages: [] }, 'wang', false, order())).toBe(false)
  expect(canEditOrder({ title: 'B' }, 'li', false, order())).toBe(false)
})

test('department admins only change the sub-steps of their own stage', () => {
  const before = [
    { id: 's', name: '销售', department: 'sales', steps: [] },
    { id: 'p', name: '生产', department: 'production', steps: ['进货'] }
  ]
  const steps = [before[0], { ...before[1], steps: ['进货', '切割'] }]
  expect(canChangeFlow(before, steps, 'ming', false, roleOf)).toBe(true)
  expect(canChangeFlow(before, steps, 'qiang', false, roleOf)).toBe(false)
  expect(canChangeFlow(before, [before[1], before[0]], 'ming', false, roleOf)).toBe(false)
  expect(canChangeFlow(before, [before[1], before[0]], 'boss', true, roleOf)).toBe(true)
  expect(canChangeFlow(before, [before[0], before[0]], 'boss', true, roleOf)).toBe(false)
})

test('insert: department admins and super admins add a stage after the current one', () => {
  const insert = { kind: 'insert', stage: 'p', name: '销售补单', department: 'sales' }
  const extra = { adminSomewhere: true, departments: ['sales', 'production'] }
  expect(canOrderAction(order(), insert, 'ming', false, roleOf, extra)).toBe(true)
  expect(canOrderAction(order(), insert, 'boss', true, roleOf, { departments: ['sales'] })).toBe(true)
  expect(canOrderAction(order(), insert, 'qiang', false, roleOf, { departments: ['sales'] })).toBe(false)
  expect(canOrderAction(order(), insert, 'li', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), { ...insert, name: ' ' }, 'ming', false, roleOf, extra)).toBe(false)
  expect(canOrderAction(order(), { ...insert, department: 'ghost' }, 'ming', false, roleOf, extra)).toBe(false)
  expect(canOrderAction(order(), { ...insert, stage: 'e' }, 'ming', false, roleOf, extra)).toBe(false)
  expect(canOrderAction({ ...order(), state: 'done' }, insert, 'ming', false, roleOf, extra)).toBe(false)
})

test('reorder accepts exactly the waiting suffix and insert checks its position', () => {
  const value = order()
  value.stages.push({ id: 'later', department: 'p', status: 'waiting', steps: [] })
  const stage = value.stages[value.current].id
  const waiting = value.stages.slice(value.current + 1).map((item) => item.id).reverse()
  const scope = { adminSomewhere: true, departments: ['p'] }
  expect(canOrderAction(value, { kind: 'reorder', stage, stageOrder: waiting }, 'admin', false, roleOf, scope)).toBe(true)
  expect(canOrderAction(value, { kind: 'reorder', stage, stageOrder: [stage, ...waiting] }, 'admin', false, roleOf, scope)).toBe(false)
  expect(canOrderAction(value, { kind: 'insert', stage, name: '返工', department: 'p', position: value.current }, 'admin', false, roleOf, scope)).toBe(false)
  expect(canOrderAction(value, { kind: 'insert', stage, name: '返工', department: 'p', position: value.stages.length }, 'admin', false, roleOf, scope)).toBe(true)
})

test('approval and rejection are limited to the selected approver and owner', () => {
  const value = order()
  const stage = value.stages[value.current]
  stage.status = 'approval'
  Object.assign(stage, { approval: { by: 'person', person: 'li' } })
  expect(canOrderAction(value, { kind: 'approve', stage: stage.id }, 'li', false, roleOf)).toBe(true)
  expect(canOrderAction(value, { kind: 'approve', stage: stage.id }, 'qiang', false, roleOf)).toBe(false)
  expect(canOrderAction(value, { kind: 'reject', stage: stage.id }, 'boss', true, roleOf)).toBe(false)
  expect(canOrderAction(value, { kind: 'reject', stage: stage.id, reason: '缺资料' }, 'boss', true, roleOf)).toBe(true)
})

test('a pending order is started by its salesperson or a scanner, and only admins may scan', () => {
  const pending = { ...order(), state: 'pending', current: 0, stages: order().stages.map((it) => ({ ...it, status: 'waiting' })) }
  const start = { kind: 'start', stage: 's' }
  expect(canOrderAction(pending, start, 'wang', false, roleOf)).toBe(true)
  expect(canOrderAction(pending, start, 'li', false, roleOf)).toBe(false)
  expect(canOrderAction(pending, start, 'ming', false, roleOf, { adminSomewhere: true })).toBe(true)
  expect(canOrderAction(pending, start, 'boss', false, roleOf, { maintainer: true })).toBe(true)
  expect(canOrderAction(pending, { kind: 'start', stage: 'p' }, 'wang', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), start, 'wang', false, roleOf)).toBe(false)
  expect(canOrderAction(pending, { kind: 'complete', stage: 's' }, 'wang', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), { kind: 'scan', stage: 'p' }, 'li', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), { kind: 'scan', stage: 'p' }, 'ming', false, roleOf, { adminSomewhere: true })).toBe(true)
  expect(canCreateOrder({ salesOwner: 'wang', state: 'pending' }, 'wang', false, true)).toBe(true)
  expect(canCreateOrder({ salesOwner: 'wang', state: 'done' }, 'wang', false, true)).toBe(false)
})

test('people working on an order may link chat, tasks, document and folder once', () => {
  expect(canEditOrder({ channel: 'c1' }, 'li', false, order(), true)).toBe(true)
  expect(canEditOrder({ channel: 'c1' }, 'zhao', false, order(), false)).toBe(false)
  expect(canEditOrder({ channel: 'c2' }, 'li', false, { ...order(), channel: 'c1' } as any, true)).toBe(false)
  expect(canEditOrder({ folder: 'f1', linkSpaces: { folder: 'd1' } }, 'wang', false, order())).toBe(true)
  expect(canEditOrder({ channel: 'c1', title: 'x' }, 'li', false, order(), true)).toBe(false)
})

test('only super admins and company admins cancel an unfinished order, with a reason', () => {
  const cancel = { kind: 'cancel', stage: 'p', reason: '客户取消' }
  expect(canOrderAction(order(), cancel, 'boss', true, roleOf)).toBe(true)
  expect(canOrderAction(order(), cancel, 'admin', false, roleOf, { maintainer: true })).toBe(true)
  expect(canOrderAction(order(), cancel, 'ming', false, roleOf, { adminSomewhere: true })).toBe(false)
  expect(canOrderAction(order(), cancel, 'wang', false, roleOf)).toBe(false)
  expect(canOrderAction(order(), { ...cancel, reason: ' ' }, 'boss', true, roleOf)).toBe(false)
  expect(canOrderAction({ ...order(), state: 'pending' }, { ...cancel, stage: 's' }, 'boss', true, roleOf)).toBe(true)
  expect(canOrderAction({ ...order(), state: 'done' }, cancel, 'boss', true, roleOf)).toBe(false)
  expect(canOrderAction({ ...order(), state: 'cancelled' }, cancel, 'boss', true, roleOf)).toBe(false)
  // A cancelled order cannot move any more.
  expect(canOrderAction({ ...order(), state: 'cancelled' }, { kind: 'complete', stage: 'p' }, 'boss', true, roleOf)).toBe(false)
})
