// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { Prospect, ProspectFieldDef } from './index'
import {
  isBuiltinProspectField, isCustomProspectField, maxProspectFields, maxProspectFieldLabel,
  maxProspectFieldOptions, maxProspectOptionLength, parseProspectDate
} from './template'

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
export type RecognitionFieldSpec = Pick<ProspectFieldDef, 'key' | 'label' | 'type' | 'options'>
export interface TemplateRecognitionResult {
  values: Record<string, string>
  needsReview: string[]
}

export function parseRecognitionFields (input: unknown): RecognitionFieldSpec[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > maxProspectFields) throw new Error('Invalid field count')
  const keys = new Set<string>()
  return input.map((entry: unknown) => {
    if (entry === null || typeof entry !== 'object') throw new Error('Invalid field')
    const { key, label, type, options } = entry as Record<string, unknown>
    if (typeof key !== 'string' || (!isBuiltinProspectField(key) && !isCustomProspectField(key)) || keys.has(key) ||
      typeof label !== 'string' || label.trim() === '' || label.length > maxProspectFieldLabel ||
      (type !== 'text' && type !== 'date' && type !== 'select') || (isBuiltinProspectField(key) && type !== 'text')) {
      throw new Error('Invalid field')
    }
    keys.add(key)
    if (type === 'select') {
      if (!Array.isArray(options) || options.length < 1 || options.length > maxProspectFieldOptions ||
        options.some((option) => typeof option !== 'string' || option.trim() === '' || option.length > maxProspectOptionLength)) {
        throw new Error('Invalid dropdown options')
      }
      return { key, label: label.trim(), type, options }
    }
    return { key, label: label.trim(), type }
  })
}

export function parseRecognition (input: unknown): RecognitionResult
export function parseRecognition (input: unknown, fields: readonly RecognitionFieldSpec[]): TemplateRecognitionResult
export function parseRecognition (
  input: unknown,
  fields: readonly RecognitionFieldSpec[] = recognitionFields.map((key) => ({ key, label: key, type: 'text' }))
): TemplateRecognitionResult {
  if (typeof input === 'string') input = JSON.parse(input) as unknown
  if (input === null || Array.isArray(input) || typeof input !== 'object') throw new Error('返回格式不对')
  const obj = input as Record<string, unknown>
  const values = Object.fromEntries(fields.map(({ key }) => [key, '']))
  const needsReview: string[] = []
  for (const { key, type, options } of fields) {
    const raw = obj[key]
    if (raw === undefined || raw === '') continue
    if (typeof raw !== 'string' || raw.length > 1000) {
      needsReview.push(key)
      continue
    }
    const value = raw.trim()
    let valid = type === 'date' ? parseProspectDate(value) !== undefined
      : type === 'select' ? options?.includes(value) === true : true
    if (key === 'email') valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    if (key === 'phone' || key === 'mobile') {
      valid = /^[+\d\s().-]+$/.test(value) && normalizePhone(value).length >= 5 && normalizePhone(value).length <= 20
    }
    if (key === 'website') {
      try {
        const url = new URL(value)
        valid = (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')
      } catch {
        valid = false
      }
    }
    if (!valid) {
      needsReview.push(key)
      continue
    }
    values[key] = value
  }
  return { values, needsReview }
}
