// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid } from '@hcengineering/core'
import type { Prospect } from '@hcengineering/prospects'
import { singaporeClock, workdays } from './schedule'

export function replyPeople (
  owner: AccountUuid | undefined, sender: AccountUuid | undefined, leads: AccountUuid[], optOut: boolean
): AccountUuid[] {
  if (optOut) return owner === undefined ? [] : [owner]
  return [...new Set([owner, sender, ...leads].filter((user): user is AccountUuid => user !== undefined))]
}

export function nextWorkdayEnd (now: number): number {
  const dayMs = 86_400_000
  let start = singaporeClock(now).end
  while (!workdays.includes(singaporeClock(start).weekday)) start += dayMs
  return start + dayMs - 1
}

export function followUpTitle (card: Pick<Prospect, 'name' | 'company'>): string {
  return `跟进客户回复 / Follow up: ${card.name}${card.company ? `（${card.company}）` : ''}`
}
