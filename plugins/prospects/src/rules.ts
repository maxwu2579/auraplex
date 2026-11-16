// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { Prospect } from './index'

export function normalizeEmail (value: string): string {
  return value.replace(/\s/g, '').toLowerCase()
}
export function normalizePhone (value: string): string {
  return value.replace(/\D/g, '')
}
export function findDuplicates (
  draft: Pick<Prospect, 'email' | 'mobile' | 'phone'>,
  existing: Prospect[],
  excludeId?: Prospect['_id']
): { email?: Prospect, phones: Prospect[] } {
  const email = normalizeEmail(draft.email)
  const phones = [draft.mobile, draft.phone].map(normalizePhone).filter((v) => v !== '')
  const others = existing.filter((p) => p._id !== excludeId)
  return {
    email: email === '' ? undefined : others.find((p) => normalizeEmail(p.email) === email),
    phones: others.filter((p) => [p.mobile, p.phone].map(normalizePhone).some((v) => v !== '' && phones.includes(v)))
  }
}

export interface ProspectStats {
  total: number
  week: number
  month: number
  source: Record<string, number>
  country: Record<string, number>
  industry: Record<string, number>
  status: Record<string, number>
}
export function prospectStats (records: Prospect[], now: Date): ProspectStats {
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const result: ProspectStats = {
    total: records.length,
    week: 0,
    month: 0,
    source: Object.create(null),
    country: Object.create(null),
    industry: Object.create(null),
    status: Object.create(null)
  }
  for (const p of records) {
    const created = p.createdOn ?? p.modifiedOn
    if (created >= weekStart.getTime() && created <= now.getTime()) result.week++
    if (created >= monthStart && created <= now.getTime()) result.month++
    for (const field of ['source', 'country', 'industry', 'status'] as const) {
      const cleaned = (p[field] ?? '').trim()
      const key = cleaned === '' ? '未填写' : cleaned
      result[field][key] = (result[field][key] ?? 0) + 1
    }
  }
  return result
}

export const recognitionFields = [
  'name',
  'company',
  'title',
  'mobile',
  'phone',
  'email',
  'website',
  'address',
  'country',
  'industry'
] as const
export type RecognitionField = (typeof recognitionFields)[number]
export type RecognitionValues = Record<RecognitionField, string>
export interface RecognitionResult {
  values: RecognitionValues
  needsReview: RecognitionField[]
}
export function parseRecognition (input: unknown): RecognitionResult {
  if (typeof input === 'string') input = JSON.parse(input) as unknown
  if (input === null || Array.isArray(input) || typeof input !== 'object') throw new Error('返回格式不对')
  const obj = input as Record<string, unknown>
  const values = Object.fromEntries(recognitionFields.map((field) => [field, ''])) as RecognitionValues
  const needsReview: RecognitionField[] = []
  for (const field of recognitionFields) {
    const raw = obj[field]
    if (raw === undefined || raw === '') continue
    if (typeof raw !== 'string' || raw.length > 1000) {
      needsReview.push(field)
      continue
    }
    const value = raw.trim()
    let valid = true
    if (field === 'email') valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    if (field === 'phone' || field === 'mobile') {
      valid = /^[+\d\s().-]+$/.test(value) && normalizePhone(value).length >= 5 && normalizePhone(value).length <= 20
    }
    if (field === 'website') {
      try {
        const url = new URL(value)
        valid = (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')
      } catch {
        valid = false
      }
    }
    if (!valid) {
      needsReview.push(field)
      continue
    }
    values[field] = value
  }
  return { values, needsReview }
}
