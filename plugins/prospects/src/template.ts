// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import type { Prospect, ProspectFieldDef } from './index'

export const builtinProspectFields = [
  'name', 'company', 'title', 'mobile', 'phone', 'email', 'website', 'address', 'country', 'industry', 'source', 'notes'
] as const
export type BuiltinProspectField = (typeof builtinProspectFields)[number]
export const maxProspectFields = 40
export const maxProspectFieldLabel = 80
export const maxProspectFieldOptions = 50
export const maxProspectOptionLength = 100

export const defaultProspectFields: readonly ProspectFieldDef[] = builtinProspectFields.map((key, order) => ({
  key, order, builtin: true, label: '', type: 'text', hidden: false
}))

export function isBuiltinProspectField (key: string): key is BuiltinProspectField {
  return builtinProspectFields.some((builtin) => builtin === key)
}

export function isRequiredProspectField (key: string): boolean {
  return key === 'name' || key === 'company'
}

export function isCustomProspectField (key: string): boolean {
  return /^c_[a-zA-Z0-9_-]{1,48}$/.test(key)
}

/** Fill in missing built-ins and always keep the identity fields visible. */
export function orderedProspectFields (fields: readonly ProspectFieldDef[] = defaultProspectFields): ProspectFieldDef[] {
  const byKey = new Map(fields.filter((field) => isBuiltinProspectField(field.key) || isCustomProspectField(field.key))
    .map((field) => [field.key, field]))
  for (const field of defaultProspectFields) {
    const current = byKey.get(field.key)
    byKey.set(field.key, current === undefined ? { ...field } : {
      ...field, label: current.label, order: current.order, hidden: current.hidden && !isRequiredProspectField(field.key)
    })
  }
  return [...byKey.values()].sort((a, b) => a.order - b.order).map((field, order) => ({ ...field, order }))
}

export function visibleProspectFields (fields?: readonly ProspectFieldDef[]): ProspectFieldDef[] {
  return orderedProspectFields(fields).filter((field) => !field.hidden)
}

export function parseProspectDate (value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return undefined
  const time = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : undefined
}

export function formatProspectFieldValue (value: string | number | undefined, type: ProspectFieldDef['type']): string {
  if (value === undefined) return ''
  if (type !== 'date' || typeof value !== 'number') return String(value)
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ''
}

export function prospectFieldValue (prospect: Prospect, field: ProspectFieldDef): string {
  const value = isBuiltinProspectField(field.key) ? prospect[field.key] : prospect.custom?.[field.key]
  return formatProspectFieldValue(value, field.type)
}

export function parseCustomProspectValue (
  field: Pick<ProspectFieldDef, 'type' | 'options'>,
  raw: string
): string | number | undefined {
  const value = raw.trim()
  if (value === '') return undefined
  if (field.type === 'date') return parseProspectDate(value)
  if (field.type === 'select' && field.options?.includes(value) !== true) return undefined
  return value
}

/** Apply the requested field list even when talking to a recognizer that ignores it. */
export function readRecognizedProspectFields (
  fields: readonly Pick<ProspectFieldDef, 'key' | 'type' | 'options'>[],
  values: Record<string, unknown>
): { builtin: Partial<Record<BuiltinProspectField, string>>, custom: Record<string, string | number> } {
  const builtin: Partial<Record<BuiltinProspectField, string>> = {}
  const custom: Record<string, string | number> = {}
  for (const field of fields) {
    const raw = values[field.key]
    if (typeof raw !== 'string' || raw.trim() === '') continue
    if (isBuiltinProspectField(field.key)) builtin[field.key] = raw.trim()
    else if (isCustomProspectField(field.key)) {
      const value = parseCustomProspectValue(field, raw)
      if (value !== undefined) custom[field.key] = value
    }
  }
  return { builtin, custom }
}
