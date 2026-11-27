// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid, Doc } from '@hcengineering/core'
import type { DepartmentAccess, Order, OrderStage } from './index'

export const taskDayMs = 86_400_000
export const singaporeZone = 'Asia/Singapore'
const clock = new Intl.DateTimeFormat('en-CA', {
  timeZone: singaporeZone, year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23', hour: '2-digit', minute: '2-digit'
})

export function singaporeClock (now: number): { date: string, weekday: number, time: string, end: number } {
  const parts = Object.fromEntries(clock.formatToParts(now).map(({ type, value }) => [type, value]))
  const date = `${parts.year}-${parts.month}-${parts.day}`
  return {
    date, weekday: new Date(date).getUTCDay(), time: `${parts.hour}:${parts.minute}`,
    end: Date.parse(`${date}T00:00:00+08:00`) + taskDayMs
  }
}

export interface ScheduledTask {
  source: Doc
  title: string
  kind?: 'order' | 'issue' | 'todo' | 'approval'
  done?: boolean
  assignee?: AccountUuid
  approvers?: AccountUuid[]
  due?: number
  href: string
  order?: { doc: Order, stage: OrderStage }
}

export type TaskSection = 0 | 1 | 2 | 3

export function isOverdue (due: number | null | undefined, finished: boolean, now: number): boolean {
  return !finished && due != null && due < now
}

export function orderDeadline (stage: { status: string, startedOn?: number, limitDays?: number }): number | undefined {
  if ((stage.status !== 'active' && stage.status !== 'approval') ||
    stage.startedOn === undefined || stage.limitDays === undefined || stage.limitDays <= 0) return undefined
  return stage.startedOn + stage.limitDays * taskDayMs
}

export function taskSection (item: ScheduledTask, employee: AccountUuid, now: number, end: number): TaskSection | undefined {
  if (item.done === true) return undefined
  const assigned = item.assignee === employee
  const approver = item.approvers?.includes(employee) === true
  if (!assigned && !approver) return undefined
  if (isOverdue(item.due, false, now)) return 0
  if (item.due !== undefined && item.due < end) return 1
  if (item.order?.stage.status === 'active' && assigned) return 2
  if (approver) return 3
}

// The app has to be in the path, or the workbench opens the last app and ignores the panel.
const panelApps: Record<string, string> = { departments: 'orders', time: 'time' }

export function panelLink (base: string, component: string, doc: Doc): string {
  const app = panelApps[component.split(':')[0]]
  return base + (app !== undefined ? '/' + app : '') + '#' + encodeURIComponent([component, doc._id, doc._class, 'content'].join('|'))
}

export function orderTask (base: string, order: Order, teams: ReadonlyMap<string, DepartmentAccess>): ScheduledTask | undefined {
  const stage = order.stages[order.current]
  if (order.state !== 'active' || (stage?.status !== 'active' && stage?.status !== 'approval')) return undefined
  const team = stage.department === undefined ? undefined : teams.get(stage.department)
  const approvers = stage.status !== 'approval' ? undefined
    : stage.approval?.by === 'person' ? [stage.approval.person]
      : team !== undefined && !team.archived ? team.administrators : undefined
  return {
    kind: 'order', approvers, source: order, title: `${order.number} ${order.title} · ${stage.name}`, assignee: stage.assignee,
    due: orderDeadline(stage), href: panelLink(base, 'departments:component:OrderPanel', order), order: { doc: order, stage }
  }
}

export function issueTask (
  base: string, issue: Doc & { identifier: string, title: string, dueDate?: number | null },
  assignee: AccountUuid | undefined, done: boolean
): ScheduledTask {
  return {
    source: issue, kind: 'issue', done, assignee, title: `${issue.identifier} ${issue.title}`,
    due: issue.dueDate ?? undefined, href: `${base}/tracker/${encodeURIComponent(issue.identifier)}`
  }
}

export function todoTask (
  base: string, todo: Doc & { title: string, doneOn?: number | null, dueDate?: number | null },
  assignee: AccountUuid | undefined, approval: boolean, title = todo.title
): ScheduledTask {
  return {
    source: todo, kind: approval ? 'approval' : 'todo', done: todo.doneOn != null, title,
    due: todo.dueDate ?? undefined, assignee, approvers: approval && assignee !== undefined ? [assignee] : undefined,
    href: panelLink(base, 'time:component:EditToDo', todo)
  }
}

export function managedTaskPeople (
  teams: Iterable<DepartmentAccess>, actor: AccountUuid
): { manages: boolean, people: Set<AccountUuid> } {
  const people = new Set<AccountUuid>()
  let manages = false
  for (const team of teams) {
    if (team.archived || !(team.administrators?.includes(actor) || team.supervisors?.includes(actor))) continue
    manages = true
    for (const person of [...(team.administrators ?? []), ...(team.supervisors ?? []), ...(team.employees ?? []), ...(team.readers ?? [])]) {
      people.add(person)
    }
  }
  return { manages, people }
}

export function approvalTaskTitle (type: string | undefined, title: string | undefined, fallback: string): string {
  if (!title) return fallback
  return type ? `${type}: ${title}` : title
}
