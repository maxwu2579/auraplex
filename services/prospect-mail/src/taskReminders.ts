// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid, Doc, Ref, TxOperations } from '@hcengineering/core'
import notification, { type DocNotifyContext } from '@hcengineering/notification'
import departments from '@hcengineering/departments'
import type { PersonSpace } from '@hcengineering/contact'
import { isOverdue, reminderRecipients } from './schedule'
import type { ScheduledRecords } from './scheduledRecords'
import type { ScheduledTask, taskSnapshot } from './taskSnapshot'

export type SendTaskMail = (user: AccountUuid, subject: string, text: string, html?: string) => Promise<void>

async function inbox (
  client: TxOperations, user: AccountUuid, space: PersonSpace, item: ScheduledTask, now: number
): Promise<void> {
  const source = item.source
  const ops = client.apply(`task-inbox:${source._id}:${user}`)
  const existing = await client.findOne(notification.class.DocNotifyContext, { objectId: source._id, user })
  const contextId = existing?._id ?? `task-mail:${source._id}:${user}` as Ref<DocNotifyContext>
  if (existing === undefined) {
    await ops.createDoc(notification.class.DocNotifyContext, space._id, {
      user, objectId: source._id, objectClass: source._class, objectSpace: source.space,
      hidden: false, isPinned: false, lastUpdateTimestamp: now
    }, contextId)
  } else {
    await ops.update(existing, { hidden: false, lastUpdateTimestamp: Math.max(existing.lastUpdateTimestamp ?? 0, now) })
  }
  await ops.createDoc(notification.class.CommonInboxNotification, space._id, {
    user, objectId: source._id, objectClass: source._class, docNotifyContext: contextId,
    header: departments.string.TaskOverdueReminder, isViewed: false, archived: false, types: [],
    messageHtml: JSON.stringify({
      type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: item.title }] }]
    })
  })
  if (!(await ops.commit()).result) throw new Error('Inbox write refused')
}

export async function sendOverdueReminders (
  client: TxOperations, records: ScheduledRecords, snapshot: Awaited<ReturnType<typeof taskSnapshot>>,
  send: SendTaskMail | undefined, now: number, date: string, onFailure: (channel: string) => void
): Promise<void> {
  const { tasks, teams, employees, spaces } = snapshot
  const employeeByAccount = new Map(employees.map((employee) => [employee.personUuid, employee]))
  const activeTeams = [...teams.values()].filter((team) => !team.archived)
  for (const item of tasks) {
    if (!isOverdue(item.due, false, now)) continue
    const order = item.order
    const team = order?.stage.department === undefined ? undefined : teams.get(order.stage.department)
    const recipients = reminderRecipients(order === undefined ? activeTeams : [], item.assignee, team)
    let attempted = false
    for (const user of recipients) {
      const employee = employeeByAccount.get(user)
      const space = employee === undefined ? undefined : spaces.get(employee._id)
      if (employee === undefined) continue
      // Read the revision again in case the task finished while preparing recipients.
      const fresh = await client.findOne(item.source._class, { _id: item.source._id, modifiedOn: item.source.modifiedOn })
      if (fresh === undefined) break
      if (!await records.claim('overdue', date, item.source._class, item.source._id, order?.stage.id ?? '', user)) continue
      attempted = true
      if (space !== undefined) {
        try {
          await inbox(client, user, space, item, now)
        } catch {
          onFailure('inbox')
        }
      }
      if (send !== undefined) {
        try {
          await send(user, 'Auraplex · 任务已过期 / Task overdue', `${item.title}\n${item.href}`)
        } catch {
          onFailure('overdue-mail')
        }
      }
    }
    if (attempted && order !== undefined) {
      const ops = client.apply(order.doc._id, 'mark-stage-reminded')
      ops.match(departments.class.Order, { _id: order.doc._id, modifiedOn: order.doc.modifiedOn })
      const stages = order.doc.stages.map((stage) => stage.id === order.stage.id ? { ...stage, remindedOn: now } : stage)
      await ops.update(order.doc, { stages })
      await ops.commit()
    }
  }
}

export const recordTaskFailure = (channel: string): void => {
  console.error(JSON.stringify({ event: 'scheduled-task-failed', channel }))
}
