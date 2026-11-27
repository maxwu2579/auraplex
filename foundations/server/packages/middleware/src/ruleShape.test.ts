// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { ruleDepartments, validRule, type RuleLike } from './ruleShape'

const rule: RuleLike = {
  name: 'fake rule',
  enabled: true,
  trigger: { kind: 'stageDone', stage: 'production' },
  condition: { department: 'fake-production' },
  action: { kind: 'todo', target: 'deptLeads', department: 'fake-engineering', title: '交接：{订单号}', dueDays: 2 }
}

test('rule shape', () => {
  expect(validRule(rule)).toBe(true)
  expect(validRule({ ...rule, trigger: { kind: 'delete-everything' } })).toBe(false)
  expect(validRule({ ...rule, action: { ...rule.action, target: 'applicant' } })).toBe(false)
  expect(validRule({ ...rule, trigger: { kind: 'appApproved' }, action: { ...rule.action, target: 'applicant' } })).toBe(true)
  expect(validRule({ ...rule, action: { ...rule.action, target: 'person' } })).toBe(false)
  expect(validRule({ ...rule, action: { ...rule.action, dueDays: 1.5 } })).toBe(false)
  expect(validRule({ ...rule, enabled: 'yes' as any })).toBe(false)
})

test('a rule is limited to the departments in its condition and action', () => {
  expect(ruleDepartments(rule)).toEqual(['fake-production', 'fake-engineering'])
  expect(ruleDepartments({ condition: {}, action: { kind: 'mail', target: 'salesOwner', title: 'x' } })).toEqual([])
})
