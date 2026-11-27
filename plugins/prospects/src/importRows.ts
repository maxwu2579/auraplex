// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// Importing existing customers from a spreadsheet: match the columns to the card template, then decide
// per row whether it is added, skipped (same email as a card already there) or added for review.

import type { Prospect, ProspectFieldDef } from './index'
import { normalizeEmail } from './rules'
import { reviewReasons } from './review'

export interface ImportColumn { key: string, label: string, field?: ProspectFieldDef }
/** Extra column for the card owner, matched by the person's email in the company. */
export const ownerColumn = 'owner'

export interface ImportRow {
  /** Row number in the sheet (1-based, header is row 1). */
  row: number
  values: Record<string, string>
  custom: Record<string, string | number>
  ownerEmail: string
  normalizedEmail: string
  review: string[]
}

export interface ImportPlan {
  add: ImportRow[]
  skipped: Array<{ row: number, reason: 'empty' | 'existing-email' | 'file-email' | 'bad-email' }>
  /** Header cells that matched no field (shown so people can fix the sheet). */
  unknownHeaders: string[]
  matched: string[]
}

const fold = (value: string): string => value.trim().toLowerCase().replace(/[\s:：*（）()]/g, '')
const emailPattern = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/

/** Which template field each header cell belongs to (by display name or field key). */
export function matchHeaders (header: readonly string[], columns: readonly ImportColumn[]): Array<string | undefined> {
  const byName = new Map<string, string>()
  for (const column of columns) {
    byName.set(fold(column.label), column.key)
    byName.set(fold(column.key), column.key)
  }
  for (const name of ['负责人', '负责人邮箱', 'owner', 'owneremail']) byName.set(fold(name), ownerColumn)
  const used = new Set<string>()
  return header.map((cell) => {
    const key = byName.get(fold(cell))
    if (key === undefined || used.has(key)) return undefined
    used.add(key)
    return key
  })
}

function customValue (field: ProspectFieldDef, text: string): string | number | undefined {
  if (text === '') return undefined
  if (field.type === 'select') return (field.options ?? []).includes(text) ? text : undefined
  if (field.type === 'date') {
    // Excel stores dates as day numbers since 1899-12-30; also accept 2026-11-27.
    const serial = Number(text)
    if (/^\d+(\.\d+)?$/.test(text) && serial > 20000 && serial < 80000) return Math.round((serial - 25569) * 86_400_000)
    const parsed = Date.parse(text.length === 10 ? `${text}T12:00:00` : text)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return text.slice(0, 1000)
}

/**
 * Plan an import. The first row is the header. Rows with neither name nor company are skipped; an email
 * that already exists (in the library or earlier in the file) is skipped; a phone number shared with
 * another card is added but put on the review list.
 */
export function planImport (
  sheet: ReadonlyArray<readonly string[]>, columns: readonly ImportColumn[], existing: readonly Prospect[]
): ImportPlan {
  const [header = [], ...rows] = sheet
  const keys = matchHeaders(header, columns)
  const byKey = new Map(columns.map((column) => [column.key, column]))
  const plan: ImportPlan = {
    add: [],
    skipped: [],
    unknownHeaders: header.filter((cell, i) => cell.trim() !== '' && keys[i] === undefined),
    matched: keys.filter((key): key is string => key !== undefined)
  }
  const known = new Set(existing.map((card) => card.normalizedEmail).filter((email) => email !== ''))
  const seen = new Set<string>()
  const others = [...existing]
  rows.forEach((cells, index) => {
    const row = index + 2
    const values: Record<string, string> = {}
    const custom: Record<string, string | number> = {}
    let ownerEmail = ''
    keys.forEach((key, i) => {
      const text = String(cells[i] ?? '').trim()
      if (key === undefined || text === '') return
      if (key === ownerColumn) ownerEmail = normalizeEmail(text)
      else {
        const field = byKey.get(key)?.field
        if (field !== undefined && !field.builtin) {
          const value = customValue(field, text)
          if (value !== undefined) custom[key] = value
        } else values[key] = text.slice(0, 1000)
      }
    })
    if (cells.every((cell) => String(cell ?? '').trim() === '')) return
    if ((values.name ?? '') === '' && (values.company ?? '') === '') {
      plan.skipped.push({ row, reason: 'empty' })
      return
    }
    const email = values.email ?? ''
    if (email !== '' && !emailPattern.test(email)) {
      plan.skipped.push({ row, reason: 'bad-email' })
      return
    }
    const normalizedEmail = normalizeEmail(email)
    if (normalizedEmail !== '' && known.has(normalizedEmail)) {
      plan.skipped.push({ row, reason: 'existing-email' })
      return
    }
    if (normalizedEmail !== '' && seen.has(normalizedEmail)) {
      plan.skipped.push({ row, reason: 'file-email' })
      return
    }
    if (normalizedEmail !== '') seen.add(normalizedEmail)
    const draft = {
      name: values.name ?? '', company: values.company ?? '', mobile: values.mobile ?? '',
      phone: values.phone ?? '', email, normalizedEmail
    }
    // Only real conflicts go to review; old records often have just a switchboard number.
    const review = reviewReasons(draft, [], others).filter((reason) => reason.startsWith('dup:'))
    plan.add.push({ row, values, custom, ownerEmail, normalizedEmail, review })
    others.push({ ...draft, _id: `import-row-${row}` } as unknown as Prospect)
  })
  return plan
}
