// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { normalizeEmail } from './rules'
import type { Prospect, ProspectMail, ProspectStatus } from './index'

export function prospectMailStatus (prospect: Pick<Prospect, 'status' | 'mailStatus'>): Exclude<ProspectStatus, 'converted'> {
  return prospect.status === 'converted' ? prospect.mailStatus ?? 'new' : prospect.status
}

export function updateProspectMailStatus (
  prospect: Pick<Prospect, 'status'>, status: 'sent' | 'replied'
): Partial<Pick<Prospect, 'status' | 'mailStatus'>> {
  return prospect.status === 'converted' ? { mailStatus: status } : { status }
}

export const SEND_COOLDOWN_MS = 60000
export function canSendMail (
  prospect: Pick<Prospect, 'email' | 'status' | 'mailStatus' | 'lastEmailAt'>,
  now: number
): string | undefined {
  const status = prospectMailStatus(prospect)
  if (status === 'do-not-send' || status === 'bounced') return '该客户不能发送邮件'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prospect.email.trim())) return '客户邮箱无效'
  if (prospect.lastEmailAt !== undefined && now - prospect.lastEmailAt < SEND_COOLDOWN_MS) { return '发送过于频繁，请稍后再试' }
  return undefined
}
/** The headers contain opaque message IDs, not email addresses; preserve case. */
export function messageIds (header: string): string[] {
  return [...header.matchAll(/<[^<>\s]{1,998}>/g)].map((match) => match[0])
}
export type MatchResult =
  | { kind: 'matched', prospect: Prospect, outgoing: ProspectMail }
  | { kind: 'unmatched' | 'ambiguous' }
/** Match only a previously sent message. Never guess if the references or sender identify multiple customers. */
export function matchReply (
  sender: string,
  headers: string[],
  outgoing: ProspectMail[],
  prospects: Prospect[]
): MatchResult {
  const candidates = outgoing.filter((item) => item.direction === 'outgoing' && item.delivery === 'sent')
  const ids = new Set(headers.flatMap(messageIds))
  const referenced = candidates.filter((item) => ids.has(item.messageId))
  const customers = new Map(prospects.map((p) => [p._id, p]))
  if (referenced.length > 0) {
    const unique = new Set(referenced.map((item) => item.attachedTo))
    if (unique.size !== 1) return { kind: 'ambiguous' }
    const item = referenced.sort((a, b) => b.sentAt - a.sentAt)[0]
    const prospect = customers.get(item.attachedTo)
    return prospect === undefined ? { kind: 'unmatched' } : { kind: 'matched', prospect, outgoing: item }
  }
  const address = normalizeEmail(sender)
  if (address === '') return { kind: 'unmatched' }
  const matches = prospects.filter((p) => normalizeEmail(p.email) === address)
  if (matches.length > 1) return { kind: 'ambiguous' }
  if (matches.length === 0) return { kind: 'unmatched' }
  const item = candidates.filter((entry) => entry.attachedTo === matches[0]._id).sort((a, b) => b.sentAt - a.sentAt)[0]
  return item === undefined ? { kind: 'unmatched' } : { kind: 'matched', prospect: matches[0], outgoing: item }
}
