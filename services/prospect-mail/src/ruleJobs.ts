// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// Automation rules handled by this service: "an order stage is overdue" (found by the scheduled
// check) and sending the emails that rules asked for (the transactor cannot reach the mailbox).
import contact from '@hcengineering/contact'
import core, { type AccountUuid, type Ref, type TxOperations } from '@hcengineering/core'
import departments, {
  addWorkdays, orderDeadline, orderRuleEvent, ruleApplies, ruleRecipients, ruleRunId, ruleText,
  type DepartmentAccess, type Order, type OrderRule, type RuleEvent, type RuleRun
} from '@hcengineering/departments'
import hr from '@hcengineering/hr'
import time from '@hcengineering/time'
import type { ScheduledRecords } from './scheduledRecords'
import { inbox, type SendTaskMail } from './taskReminders'

/** Orders whose current stage passed its time limit, as rule events (once per stage start). */
export function overdueEvents (orders: readonly Order[], now: number): RuleEvent[] {
  return orders.flatMap((order) => {
    const stage = order.stages[order.current]
    if (order.state !== 'active' || stage === undefined) return []
    const deadline = orderDeadline(stage)
    if (deadline === undefined || deadline >= now) return []
    return [orderRuleEvent('stageOverdue', order, order.current, stage.startedOn ?? 0)]
  })
}

async function teams (client: TxOperations): Promise<DepartmentAccess[]> {
  const hierarchy = client.getHierarchy()
  const docs = await client.findAll(hr.class.Department, {})
  return docs.filter((doc) => hierarchy.hasMixin(doc, departments.mixin.DepartmentAccess))
    .map((doc) => hierarchy.as(doc, departments.mixin.DepartmentAccess)).filter((doc) => !doc.archived)
}

async function act (
  client: TxOperations, rule: OrderRule, event: RuleEvent, people: AccountUuid[], now: number
): Promise<Partial<RuleRun>> {
  const text = ruleText(rule.action.title, event)
  const order = event.target as Order
  if (rule.action.kind === 'mail') {
    return { mail: { to: people, subject: 'Auraplex · ' + text, text: text + '\n' + event.label }, mailState: 'pending' }
  }
  const employees = await client.findAll(contact.mixin.Employee, { personUuid: { $in: people }, active: true })
  if (employees.length === 0) return { result: 'skipped', reason: '这些人没有员工账号' }
  if (rule.action.kind === 'todo') {
    for (const employee of employees) {
      await client.addCollection(time.class.ToDo, time.space.ToDos, order._id, order._class, 'ruleTodos', {
        user: employee._id, title: text, description: '', workslots: 0, priority: 3 as any,
        visibility: 'private', doneOn: null, dueDate: addWorkdays(now, rule.action.dueDays ?? 1), rank: '0|hzzzzz:'
      } as any)
    }
    return {}
  }
  const spaces = await client.findAll(contact.class.PersonSpace, { person: { $in: employees.map((it) => it._id) } })
  for (const employee of employees) {
    const space = spaces.find((it) => it.person === employee._id)
    if (space === undefined || employee.personUuid === undefined) continue
    await inbox(client, employee.personUuid, space, { source: order, title: `${text}\n${event.label}`, href: '' }, now)
  }
  return {}
}

/** "Order stage overdue" rules: run once per rule and overdue stage, claimed so two workers never both act. */
export async function runOverdueRules (client: TxOperations, records: ScheduledRecords, now: number): Promise<void> {
  const rules = (await client.findAll(departments.class.OrderRule, { enabled: true }))
    .filter((rule) => rule.trigger.kind === 'stageOverdue')
  if (rules.length === 0) return
  const events = overdueEvents(await client.findAll(departments.class.Order, { state: 'active' }), now)
  if (events.length === 0) return
  const allTeams = await teams(client)
  for (const event of events) {
    for (const rule of rules) {
      if (!ruleApplies(rule, event).ok) continue
      const id = ruleRunId(rule._id, event.key) as Ref<RuleRun>
      if (await client.findOne(departments.class.RuleRun, { _id: id }) !== undefined) continue
      if (!await records.claim('rule', 'once', id)) continue
      const people = ruleRecipients(rule.action, event, (team) => allTeams.find((it) => it._id === team))
      let outcome: Partial<RuleRun> = people.length === 0 ? { result: 'skipped', reason: '找不到要通知的人' } : {}
      if (people.length > 0) {
        try {
          outcome = await act(client, rule, event, people, now)
        } catch {
          outcome = { result: 'failed', reason: '执行出错' }
        }
      }
      await client.createDoc(departments.class.RuleRun, core.space.Workspace, {
        rule: rule._id, target: event.target._id, targetClass: event.target._class, label: event.label,
        key: event.key, at: now, result: 'done', recipients: people, ...outcome
      }, id)
    }
  }
}

/** Send emails rules asked for. Without a company mailbox they are marked as not sent. */
export async function sendRuleMails (
  client: TxOperations, records: ScheduledRecords, send: SendTaskMail | undefined
): Promise<void> {
  const pending = await client.findAll(departments.class.RuleRun, { mailState: 'pending' })
  for (const run of pending) {
    if (run.mail === undefined) continue
    if (!await records.claim('rule-mail', 'once', run._id)) continue
    if (send === undefined) {
      await client.update(run, { mailState: 'failed', reason: '公司邮箱没配置' })
      continue
    }
    let failed = 0
    for (const user of run.mail.to) {
      try {
        await send(user, run.mail.subject, run.mail.text)
      } catch {
        failed++
      }
    }
    await client.update(run, failed === 0 ? { mailState: 'sent' } : { mailState: 'failed', reason: `${failed} 封没发出` })
  }
}
