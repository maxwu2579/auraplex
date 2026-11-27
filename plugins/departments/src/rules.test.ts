// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid, Ref } from '@hcengineering/core'
import type { Department } from '@hcengineering/hr'
import type { Order } from './index'
import { boardPlace } from './board'
import { panelLink } from './tasks'
import {
  addWorkdays, applicationRuleEvent, orderRuleEvent, ruleApplies, ruleRecipients, ruleRunId, ruleText, validRule,
  type OrderRule
} from './rules'

const sales = 'fake-sales' as AccountUuid
const worker = 'fake-worker' as AccountUuid
const admin = 'fake-admin' as AccountUuid
const sup = 'fake-sup' as AccountUuid
const prod = 'fake-production' as Ref<Department>
const eng = 'fake-engineering' as Ref<Department>
const day = 86_400_000
const now = Date.parse('2026-11-27T04:00:00Z') // Friday 12:00 in Singapore

function order (patch: Partial<Order> = {}): Order {
  return {
    _id: 'fake-order', _class: 'departments:class:Order', space: 'space', modifiedOn: 0, modifiedBy: 'x',
    number: 'ORD-9', title: '测试贴标机', customer: '测试客户', note: '', salesOwner: sales, current: 2, state: 'active',
    stages: [
      { id: 'sales', name: '销售', status: 'done', steps: [] },
      { id: 'design', name: '设计', status: 'done', steps: [] },
      { id: 'production', name: '生产', department: prod, status: 'active', assignee: worker, startedOn: now - day, limitDays: 3, steps: [] },
      { id: 'engineering', name: '工程', department: eng, status: 'waiting', steps: [] }
    ],
    ...patch
  } as unknown as Order
}

const rule = (patch: Partial<OrderRule> = {}): OrderRule => ({
  _id: 'fake-rule', _class: 'departments:class:OrderRule', space: 'space', modifiedOn: 0, modifiedBy: 'x',
  name: '生产完成 → 工程交接', enabled: true,
  trigger: { kind: 'stageDone', stage: 'production' },
  condition: {},
  action: { kind: 'todo', target: 'deptSupervisors', department: eng, title: '交接：{订单号} {订单名}', dueDays: 2 },
  ...patch
} as unknown as OrderRule)

const leads = (id: string): { administrators: AccountUuid[], supervisors: AccountUuid[] } | undefined =>
  id === eng ? { administrators: [admin], supervisors: [sup] } : id === prod ? { administrators: [admin], supervisors: [] } : undefined

test('board columns', () => {
  expect(boardPlace(order(), now)?.column).toBe('active')
  expect(boardPlace(order({ stages: order().stages.map((s, i) => i === 2 ? { ...s, startedOn: now - 5 * day } : s) }), now)?.column).toBe('overdue')
  expect(boardPlace(order({ stages: order().stages.map((s, i) => i === 2 ? { ...s, status: 'approval' } : s) }), now)).toMatchObject({ column: 'blocked', blockedBy: 'approval' })
  expect(boardPlace(order({ stages: order().stages.map((s, i) => i === 2 ? { ...s, assignee: undefined } : s) }), now)?.column).toBe('waiting')
  const unpaid = order({ current: 1, stages: order().stages.map((s, i) => i === 1 ? { ...s, status: 'waiting' } : i === 2 ? { ...s, status: 'waiting' } : s) })
  expect(boardPlace(unpaid, now)).toMatchObject({ column: 'blocked', blockedBy: 'payment' })
  expect(boardPlace({ ...unpaid, paidOn: now }, now)?.column).toBe('waiting')
  expect(boardPlace(order({ state: 'pending' }), now)?.column).toBe('waiting')
  expect(boardPlace(order({ state: 'done' }), now)).toBeUndefined()
})

test('rules match the stage, department and text conditions', () => {
  const done = orderRuleEvent('stageDone', order(), 2, now)
  expect(ruleApplies(rule(), done).ok).toBe(true)
  expect(ruleApplies(rule(), orderRuleEvent('stageDone', order(), 1, now)).ok).toBe(false)
  expect(ruleApplies(rule(), orderRuleEvent('stageStart', order(), 2, now)).ok).toBe(false)
  expect(ruleApplies(rule({ condition: { department: eng } }), done).ok).toBe(false)
  expect(ruleApplies(rule({ condition: { department: prod, customer: '测试' } }), done).ok).toBe(true)
  expect(ruleApplies(rule({ condition: { title: '没有这个' } }), done).ok).toBe(false)
  expect(ruleApplies(rule({ trigger: { kind: 'stageDone' } }), orderRuleEvent('stageDone', order(), 1, now)).ok).toBe(true)
})

test('recipients, text and run ids', () => {
  const done = orderRuleEvent('stageDone', order(), 2, now)
  expect(ruleRecipients(rule().action, done, leads)).toEqual([sup])
  expect(ruleRecipients({ ...rule().action, target: 'deptLeads', department: undefined }, done, leads)).toEqual([admin])
  expect(ruleRecipients({ ...rule().action, target: 'stageAssignee' }, done, leads)).toEqual([worker])
  expect(ruleRecipients({ ...rule().action, target: 'salesOwner' }, done, leads)).toEqual([sales])
  expect(ruleText('交接：{订单号} {订单名} {客户} {阶段} {未知}', done)).toBe('交接：ORD-9 测试贴标机 测试客户 生产 {未知}')
  expect(ruleRunId('a', done.key)).toBe(ruleRunId('a', done.key))
  expect(ruleRunId('a', done.key)).not.toBe(ruleRunId('a', orderRuleEvent('stageDone', order(), 2, now + 1).key))
  const app = applicationRuleEvent('appApproved', { _id: 'fake-card', _class: 'fake:type', title: '报销', space: 's', modifiedOn: 0, modifiedBy: 'x' } as any, sales, [prod], 1)
  expect(ruleApplies(rule({ trigger: { kind: 'appApproved', appType: 'fake:type' }, condition: { department: prod } }), app).ok).toBe(true)
  expect(ruleRecipients({ kind: 'notify', target: 'applicant', title: 'x' }, app, leads)).toEqual([sales])
})

test('working days skip the weekend (Singapore)', () => {
  const end = addWorkdays(now, 1) // Friday + 1 working day = Monday
  expect(new Date(end + 8 * 3_600_000).getUTCDay()).toBe(1)
  expect(new Date(addWorkdays(now, 0) + 8 * 3_600_000).getUTCDay()).toBe(5)
})

test('rule shape check', () => {
  expect(validRule(rule())).toBe(true)
  expect(validRule(rule({ name: ' ' }))).toBe(false)
  expect(validRule(rule({ action: { kind: 'todo', target: 'applicant', title: 'x' } }))).toBe(false)
  expect(validRule(rule({ action: { kind: 'notify', target: 'person', title: 'x' } }))).toBe(false)
  expect(validRule(rule({ action: { kind: 'todo', target: 'salesOwner', title: 'x', dueDays: -1 } }))).toBe(false)
})

test('task links name the app so the workbench opens the panel', () => {
  const doc = { _id: 'fake-id', _class: 'departments:class:Order' } as any
  expect(panelLink('/workbench/ws', 'departments:component:OrderPanel', doc)).toBe(
    '/workbench/ws/orders#' + encodeURIComponent('departments:component:OrderPanel|fake-id|departments:class:Order|content'))
  expect(panelLink('/workbench/ws', 'time:component:EditToDo', doc).startsWith('/workbench/ws/time#')).toBe(true)
})
