// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// Business cards that need a person to look at them, and possible duplicates. Pure helpers shared
// by batch auto-save, the review page and the merge dialog.
import type { AccountUuid, Ref } from '@hcengineering/core'
import type { Prospect, ProspectStatus } from './index'

/** Review reasons stored on a card: 'field:<key>' (the AI was unsure), 'dup:<id>', 'switchboard'. */
export type ReviewReason = string

/** Last 8 digits, so "+65 6123 4567" and "61234567" match; shorter numbers are ignored. */
export function phoneKey (value: string | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(-8) : ''
}

/** Lower case without spaces and punctuation; also drops common company endings. */
export function textKey (value: string | undefined): string {
  return (value ?? '').toLowerCase()
    .replace(/(co\.?,?\s*ltd\.?|pte\.?\s*ltd\.?|limited|inc\.?|corp\.?|有限公司|股份|公司)/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

export function similarNames (a: string | undefined, b: string | undefined): boolean {
  const x = textKey(a)
  const y = textKey(b)
  if (x.length < 2 || y.length < 2) return false
  return x === y || x.includes(y) || y.includes(x)
}

export type DuplicateWhy = 'email' | 'phone' | 'name'
type CardLike = Pick<Prospect, '_id' | 'name' | 'company' | 'mobile' | 'phone' | 'normalizedEmail'> & {
  notDuplicate?: Array<Ref<Prospect>>
}

/** Why two cards look like the same person, or undefined. */
export function duplicateWhy (a: CardLike, b: CardLike): DuplicateWhy | undefined {
  if (a._id === b._id) return undefined
  if (a.notDuplicate?.includes(b._id) === true || b.notDuplicate?.includes(a._id) === true) return undefined
  if (a.normalizedEmail !== '' && a.normalizedEmail === b.normalizedEmail) return 'email'
  const phones = new Set([phoneKey(a.mobile), phoneKey(a.phone)].filter(Boolean))
  if ([phoneKey(b.mobile), phoneKey(b.phone)].some((key) => key !== '' && phones.has(key))) return 'phone'
  if (textKey(a.company) !== '' && textKey(a.company) === textKey(b.company) && similarNames(a.name, b.name)) return 'name'
}

/** All pairs of possible duplicates; groups by email, phone and company first so 1000s of cards stay fast. */
export function duplicatePairs<T extends CardLike> (cards: readonly T[]): Array<{ a: T, b: T, why: DuplicateWhy }> {
  const buckets = new Map<string, T[]>()
  const put = (key: string, card: T): void => {
    if (key === '') return
    const list = buckets.get(key)
    if (list === undefined) buckets.set(key, [card])
    else list.push(card)
  }
  for (const card of cards) {
    put('e:' + card.normalizedEmail, card)
    put('p:' + phoneKey(card.mobile), card)
    put('p:' + phoneKey(card.phone), card)
    const company = textKey(card.company)
    if (company !== '') put('c:' + company, card)
  }
  const seen = new Set<string>()
  const pairs: Array<{ a: T, b: T, why: DuplicateWhy }> = []
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 200) continue
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = list[i]._id < list[j]._id ? [list[i], list[j]] : [list[j], list[i]]
        const id = `${a._id}|${b._id}`
        if (seen.has(id)) continue
        const why = duplicateWhy(a, b)
        if (why === undefined) continue
        seen.add(id)
        pairs.push({ a, b, why })
      }
    }
  }
  return pairs
}

/** Why a freshly recognized card should wait for a person (empty = save as confirmed-by-AI). */
export function reviewReasons (
  draft: Pick<Prospect, 'name' | 'company' | 'mobile' | 'phone' | 'email'> & { normalizedEmail: string },
  unsure: readonly string[], others: readonly CardLike[]
): ReviewReason[] {
  const reasons = new Set<ReviewReason>(unsure.map((key) => 'field:' + key))
  const me = { ...draft, _id: '' as Ref<Prospect> }
  for (const other of others) {
    const why = duplicateWhy(me, other)
    if (why === undefined) continue
    // Same name and company with the same number is simply the same person: still worth a look.
    reasons.add('dup:' + other._id)
  }
  if (draft.phone.trim() !== '' && draft.mobile.trim() === '' && draft.email.trim() === '') reasons.add('switchboard')
  return [...reasons]
}

/** Status after merging: never lose "do not send" or "bounced"; otherwise keep the furthest along. */
export function mergedStatus (a: ProspectStatus, b: ProspectStatus): ProspectStatus {
  const order: ProspectStatus[] = ['do-not-send', 'bounced', 'converted', 'replied', 'sent', 'new']
  return order.find((status) => status === a || status === b) ?? a
}

export interface MergeRecord { name: string, company: string, by: AccountUuid, on: number }
