// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// Automation rules: "when → if → do". Pure helpers shared by the settings page (dry run),
// the server triggers and the scheduled overdue check, so all three decide the same way.
import type { AccountUuid, Doc, Ref } from '@hcengineering/core'
import type { Department } from '@hcengineering/hr'
import type { DepartmentAccess, Order, OrderStage } from './index'

export type RuleTriggerKind = 'stageDone' | 'stageStart' | 'paid' | 'stageOverdue' | 'appApproved' | 'appRejected'
export const ruleTriggerKinds: RuleTriggerKind[] = ['stageDone', 'stageStart', 'paid', 'stageOverdue', 'appApproved', 'appRejected']
export const orderTriggerKinds: RuleTriggerKind[] = ['stageDone', 'stageStart', 'paid', 'stageOverdue']

export type RuleTarget = 'deptAdmins' | 'deptSupervisors' | 'deptLeads' | 'stageAssignee' | 'salesOwner' | 'applicant' | 'person'
export const orderTargets: RuleTarget[] = ['deptLeads', 'deptAdmins', 'deptSupervisors', 'stageAssignee', 'salesOwner', 'person']
export const applicationTargets: RuleTarget[] = ['applicant', 'deptLeads', 'deptAdmins', 'deptSupervisors', 'person']

export type RuleActionKind = 'todo' | 'notify' | 'mail'
export const ruleActionKinds: RuleActionKind[] = ['todo', 'notify', 'mail']

export interface RuleTrigger {
  kind: RuleTriggerKind
  /** Order stage id (flow template id); empty = any stage. */
  stage?: string
  /** Application type (card MasterTag); empty = any type. */
  appType?: string
}

export interface RuleCondition {
  /** Orders: the stage's department. Applications: one of the applicant's departments. */
  department?: Ref<Department>
  customer?: string
  title?: string
}

export interface RuleAction {
  kind: RuleActionKind
  target: RuleTarget
  /** For department targets: this department; empty = the department of the event. */
  department?: Ref<Department>
  person?: AccountUuid
  /** To-do title / message, with {订单号} {订单名} {客户} {阶段} {申请标题}. */
  title: string
  /** To-do due date: this many working days later (end of day, Singapore). */
  dueDays?: number
}

export interface OrderRule extends Doc {
  name: string
  enabled: boolean
  trigger: RuleTrigger
  condition: RuleCondition
  action: RuleAction
}

export type RuleRunResult = 'done' | 'skipped' | 'failed'
export interface RuleRunMail { to: AccountUuid[], subject: string, text: string }
export interface RuleRun extends Doc {
  rule: Ref<OrderRule>
  target: Ref<Doc>
  targetClass: string
  /** What happened, e.g. "ORD-0003 测试 · 生产 完成". */
  label: string
  key: string
  at: number
  result: RuleRunResult
  reason?: string
  recipients?: AccountUuid[]
  mail?: RuleRunMail
  mailState?: 'pending' | 'sent' | 'failed'
}

/** Something that happened which rules may react to. */
export interface RuleEvent {
  kind: RuleTriggerKind
  /** Once per real occurrence: a stage finished again after a return is a new event. */
  key: string
  target: Doc
  label: string
  stageId?: string
  stageName?: string
  /** Department the event belongs to (order stage department, or the applicant's departments). */
  departments: string[]
  stageAssignee?: AccountUuid
  salesOwner?: AccountUuid
  applicant?: AccountUuid
  appType?: string
  orderNumber?: string
  orderTitle?: string
  customer?: string
  appTitle?: string
}

export interface TeamLeads { administrators: AccountUuid[], supervisors: AccountUuid[] }

export type RuleCheck = { ok: true } | { ok: false, reason: string }

const contains = (value: string | undefined, part: string | undefined): boolean =>
  part === undefined || part.trim() === '' || (value ?? '').toLowerCase().includes(part.trim().toLowerCase())

/** Does the rule react to this event? The reason (Chinese) is shown in the dry run and the run log. */
export function ruleApplies (rule: Pick<OrderRule, 'trigger' | 'condition'>, event: RuleEvent): RuleCheck {
  const { trigger, condition } = rule
  if (trigger.kind !== event.kind) return { ok: false, reason: '触发不同' }
  if (trigger.stage !== undefined && trigger.stage !== '' && trigger.stage !== event.stageId) {
    return { ok: false, reason: '不是规则选的阶段' }
  }
  if (trigger.appType !== undefined && trigger.appType !== '' && trigger.appType !== event.appType) {
    return { ok: false, reason: '不是规则选的申请类型' }
  }
  if (condition.department !== undefined && !event.departments.includes(condition.department)) {
    return { ok: false, reason: '部门不符合条件' }
  }
  if (!contains(event.customer, condition.customer)) return { ok: false, reason: '客户名不含条件里的文字' }
  if (!contains(event.orderTitle ?? event.appTitle, condition.title)) return { ok: false, reason: '名称不含条件里的文字' }
  return { ok: true }
}

/** Who the action goes to. Departments come from the action, else from the event. */
export function ruleRecipients (
  action: RuleAction, event: RuleEvent, leadsOf: (department: string) => TeamLeads | undefined
): AccountUuid[] {
  const departments = action.department !== undefined ? [action.department] : event.departments
  const people: AccountUuid[] = []
  const leads = departments.map(leadsOf).filter((it): it is TeamLeads => it !== undefined)
  switch (action.target) {
    case 'deptAdmins': leads.forEach((it) => people.push(...it.administrators)); break
    case 'deptSupervisors': leads.forEach((it) => people.push(...it.supervisors)); break
    case 'deptLeads': leads.forEach((it) => people.push(...it.administrators, ...it.supervisors)); break
    case 'stageAssignee': if (event.stageAssignee !== undefined) people.push(event.stageAssignee); break
    case 'salesOwner': if (event.salesOwner !== undefined) people.push(event.salesOwner); break
    case 'applicant': if (event.applicant !== undefined) people.push(event.applicant); break
    case 'person': if (action.person !== undefined) people.push(action.person); break
  }
  return [...new Set(people)]
}

/** Fill {订单号} {订单名} {客户} {阶段} {申请标题} (and the English names) in a title. */
export function ruleText (template: string, event: RuleEvent): string {
  const values: Record<string, string> = {
    订单号: event.orderNumber ?? '',
    订单名: event.orderTitle ?? '',
    客户: event.customer ?? '',
    阶段: event.stageName ?? '',
    申请标题: event.appTitle ?? '',
    order: event.orderNumber ?? '',
    title: event.orderTitle ?? event.appTitle ?? '',
    customer: event.customer ?? '',
    stage: event.stageName ?? ''
  }
  return template.replace(/\{([^{}]+)\}/g, (all, name: string) => values[name.trim()] ?? all).trim()
}

const dayMs = 86_400_000
/** End of the day `days` working days (Mon–Fri, Singapore) after `now`; 0 = end of today. */
export function addWorkdays (now: number, days: number): number {
  const shift = 8 * 3_600_000
  let local = new Date(now + shift)
  let left = Math.max(0, Math.floor(days))
  while (left > 0) {
    local = new Date(local.getTime() + dayMs)
    const weekday = local.getUTCDay()
    if (weekday !== 0 && weekday !== 6) left--
  }
  const end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + dayMs - 1
  return end - shift
}

/** The stored id of a run: the same rule, target and occurrence always give the same id. */
export function ruleRunId (rule: string, eventKey: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  const text = `${rule}|${eventKey}`
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0
  }
  return `rule-run-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
}

/** Departments a rule is limited to; department admins may only manage rules inside their own. */
export function ruleDepartments (rule: Pick<OrderRule, 'condition' | 'action'>): string[] {
  return [rule.condition.department, rule.action.department].filter((it): it is Ref<Department> => it !== undefined && it !== '')
}

/** Basic shape check, used by the page before saving and by the server guard. */
export function validRule (rule: Partial<OrderRule>): boolean {
  const { trigger, condition, action, name, enabled } = rule
  if (typeof name !== 'string' || name.trim() === '' || name.length > 200 || typeof enabled !== 'boolean') return false
  if (trigger === undefined || !ruleTriggerKinds.includes(trigger.kind)) return false
  if (condition === undefined || condition === null || typeof condition !== 'object') return false
  if (action === undefined || !ruleActionKinds.includes(action.kind)) return false
  const app = trigger.kind === 'appApproved' || trigger.kind === 'appRejected'
  if (!(app ? applicationTargets : orderTargets).includes(action.target)) return false
  if (action.target === 'person' && (action.person === undefined || action.person === '')) return false
  if (typeof action.title !== 'string' || action.title.trim() === '' || action.title.length > 500) return false
  if (action.dueDays !== undefined && (!Number.isSafeInteger(action.dueDays) || action.dueDays < 0 || action.dueDays > 60)) return false
  return [condition.customer, condition.title].every((it) => it === undefined || (typeof it === 'string' && it.length <= 200))
}

/** An order event: the stage at `index` finished / started / went overdue, or the order was paid. */
export function orderRuleEvent (
  kind: RuleTriggerKind, order: Order, index: number, occurrence: string | number
): RuleEvent {
  const stage: OrderStage | undefined = order.stages[index]
  const stageId = stage?.id
  return {
    kind,
    key: `${order._id}|${kind}|${kind === 'paid' ? '' : stageId ?? ''}|${occurrence}`,
    target: order,
    label: `${order.number} ${order.title}${stage !== undefined && kind !== 'paid' ? ' · ' + stage.name : ''}`,
    stageId,
    stageName: stage?.name,
    departments: stage?.department !== undefined ? [stage.department] : [],
    stageAssignee: stage?.assignee,
    salesOwner: order.salesOwner,
    orderNumber: order.number,
    orderTitle: order.title,
    customer: order.customer
  }
}

/** An application (card with an approval process) was approved or rejected. */
export function applicationRuleEvent (
  kind: 'appApproved' | 'appRejected', card: Doc & { title?: string }, applicant: AccountUuid | undefined,
  applicantDepartments: string[], occurrence: string | number
): RuleEvent {
  return {
    kind,
    key: `${card._id}|${kind}|${occurrence}`,
    target: card,
    label: card.title ?? '',
    departments: applicantDepartments,
    applicant,
    appType: card._class,
    appTitle: card.title ?? ''
  }
}

/** Departments where someone is a member (any role), used for the applicant's departments. */
export function memberDepartments (teams: readonly DepartmentAccess[], who: AccountUuid | undefined): string[] {
  if (who === undefined) return []
  return teams.filter((team) => !team.archived && [team.administrators, team.supervisors, team.employees, team.readers]
    .some((list) => list.includes(who))).map((team) => team._id)
}
