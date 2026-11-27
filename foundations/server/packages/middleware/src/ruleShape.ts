// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// Server copy of the automation rule shape check (plugins/departments/src/rules.ts), kept here like
// orderPolicy.ts so the middleware does not depend on the departments plugin. Keep both in step.

export interface RuleLike {
  name: string
  enabled: boolean
  trigger: { kind: string, stage?: string, appType?: string }
  condition: { department?: string, customer?: string, title?: string }
  action: { kind: string, target: string, department?: string, person?: string, title: string, dueDays?: number }
}

const triggers = ['stageDone', 'stageStart', 'paid', 'stageOverdue', 'appApproved', 'appRejected']
const actions = ['todo', 'notify', 'mail']
const orderTargets = ['deptLeads', 'deptAdmins', 'deptSupervisors', 'stageAssignee', 'salesOwner', 'person']
const applicationTargets = ['applicant', 'deptLeads', 'deptAdmins', 'deptSupervisors', 'person']

export function ruleDepartments (rule: Pick<RuleLike, 'condition' | 'action'>): string[] {
  return [rule.condition?.department, rule.action?.department].filter((it): it is string => typeof it === 'string' && it !== '')
}

export function validRule (rule: Partial<RuleLike> | undefined): boolean {
  if (rule === undefined || rule === null) return false
  const { trigger, condition, action, name, enabled } = rule
  if (typeof name !== 'string' || name.trim() === '' || name.length > 200 || typeof enabled !== 'boolean') return false
  if (trigger == null || !triggers.includes(trigger.kind)) return false
  if (condition == null || typeof condition !== 'object') return false
  if (action == null || !actions.includes(action.kind)) return false
  const app = trigger.kind === 'appApproved' || trigger.kind === 'appRejected'
  if (!(app ? applicationTargets : orderTargets).includes(action.target)) return false
  if (action.target === 'person' && (typeof action.person !== 'string' || action.person === '')) return false
  if (typeof action.title !== 'string' || action.title.trim() === '' || action.title.length > 500) return false
  if (action.dueDays !== undefined && (!Number.isSafeInteger(action.dueDays) || action.dueDays < 0 || action.dueDays > 60)) return false
  return [condition.customer, condition.title].every((it) => it === undefined || (typeof it === 'string' && it.length <= 200))
}
