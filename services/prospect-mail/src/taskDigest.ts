// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid } from '@hcengineering/core'
import { taskMailLabel } from './taskMailLabels'
import { isOverdue, workdays, type singaporeClock } from './schedule'
import type { ScheduledRecords } from './scheduledRecords'
import type { SendTaskMail } from './taskReminders'
import type { ScheduledTask } from './taskSnapshot'

export interface DigestSettings {
  enabled: boolean
  time: string
  days: number[]
}

export const defaultDigest: DigestSettings = { enabled: true, time: '08:00', days: [...workdays] }

export function parseDigestSettings (value: unknown): DigestSettings | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const { enabled, time, days } = value as Partial<DigestSettings>
  if (typeof enabled !== 'boolean' || typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ||
    !Array.isArray(days) || days.length > 7 || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
    (enabled && days.length === 0)) return undefined
  return { enabled, time, days: [...new Set(days)].sort() }
}

export function digestIsDue (settings: DigestSettings, day: ReturnType<typeof singaporeClock>): boolean {
  return settings.enabled && settings.days.includes(day.weekday) && day.time >= settings.time
}

const sections = [
  [taskMailLabel('TaskMailOverdue'), '#a82725'],
  [taskMailLabel('TaskMailDueToday'), '#1f2937'],
  [taskMailLabel('TaskMailActiveOrders'), '#1f2937'],
  [taskMailLabel('TaskMailPendingApproval'), '#1f2937']
] as const

export interface DigestRow { title: string, href: string, section: 0 | 1 | 2 | 3 }

export function digestRows (tasks: ScheduledTask[], employee: AccountUuid, now: number, endOfDay: number): DigestRow[] {
  const rows: DigestRow[] = []
  for (const item of tasks) {
    const assigned = item.assignee === employee
    const approver = item.approvers?.includes(employee) === true
    if (!assigned && !approver) continue
    const section = isOverdue(item.due, false, now) ? 0
      : item.due !== undefined && item.due < endOfDay ? 1
        : item.order?.stage.status === 'active' && assigned ? 2
          : approver ? 3 : undefined
    if (section !== undefined) rows.push({ title: item.title, href: item.href, section })
  }
  return rows.sort((a, b) => a.section - b.section)
}

function escapeHtml (value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

export function formatDigest (rows: DigestRow[]): { text: string, html: string } {
  const text: string[] = []
  const html: string[] = ['<div style="background:#ffffff;padding:16px">']
  sections.forEach(([heading, color], index) => {
    const items = rows.filter((row) => row.section === index)
    if (items.length === 0) return
    text.push(heading, ...items.map((row) => `• ${row.title} — ${row.href}`), '')
    html.push(`<h3 style="color:${color}">${heading}</h3><ul>`)
    for (const row of items) {
      html.push(`<li><a style="color:${color}" href="${escapeHtml(row.href)}">${escapeHtml(row.title)}</a></li>`)
    }
    html.push('</ul>')
  })
  html.push('</div>')
  return { text: text.join('\n'), html: html.join('') }
}

export async function sendDailyDigest (
  records: ScheduledRecords, send: SendTaskMail, tasks: ScheduledTask[], employees: AccountUuid[],
  date: string, now: number, endOfDay: number, onFailure: (channel: string) => void
): Promise<boolean> {
  let claimsReady = true
  for (const employee of new Set(employees)) {
    const rows = digestRows(tasks, employee, now, endOfDay)
    if (rows.length === 0) continue
    try {
      if (!await records.claim('daily', date, employee)) continue
    } catch {
      claimsReady = false
      onFailure('digest-claim')
      continue
    }
    try {
      const { text, html } = formatDigest(rows)
      await send(employee, `Auraplex · ${taskMailLabel('TaskMailDigestSubject')}`, text, html)
    } catch {
      onFailure('daily-mail')
    }
  }
  return claimsReady
}
