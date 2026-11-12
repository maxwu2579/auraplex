// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0

import { normalizeCode, parseQuantity, type Material } from './index'
import type { Ref } from '@hcengineering/core'

export interface StockImportRow {
  row: number
  code: string
  name: string
  stock: string
  minimum: string
  minimumPresent?: boolean
  model?: string
  brand?: string
  category?: string
  group?: string
  rack?: string
  level?: string
  invalidCode?: boolean
  invalidStockCell?: boolean
  invalidMinimumCell?: boolean
}
export type StockImportIssue =
  | 'invalidCode'
  | 'missingCode'
  | 'missingName'
  | 'duplicateCode'
  | 'blankStock'
  | 'invalidStock'
  | 'invalidMinimum'

/** Problem rows are excluded until the user resolves them. No duplicate quantities are combined. */
export function previewStockRows (
  rows: StockImportRow[],
  existing: Material[],
  withMovements?: ReadonlySet<Ref<Material>>
): Array<{
    row: StockImportRow
    issues: StockImportIssue[]
    existing?: Material
    stock?: number
    minimum?: number
    preserveStock: boolean
  }> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const code = normalizeCode(row.code)
    if (code !== '') counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  const byCode = new Map(existing.map((item) => [item.normalizedCode, item]))
  return rows.map((row) => {
    const issues: StockImportIssue[] = []
    const code = normalizeCode(row.code)
    const material = byCode.get(code)
    if (row.invalidCode === true) issues.push('invalidCode')
    else if (code === '') issues.push('missingCode')
    if (row.name.trim() === '') issues.push('missingName')
    if ((counts.get(code) ?? 0) > 1) issues.push('duplicateCode')
    const stock = parseQuantity(row.stock)
    if (row.stock.trim() === '') issues.push('blankStock')
    else if (stock === undefined || row.invalidStockCell === true) issues.push('invalidStock')
    const minimum = row.minimum.trim() === '' ? undefined : parseQuantity(row.minimum)
    if (row.invalidMinimumCell === true || (row.minimum.trim() !== '' && minimum === undefined)) {
      issues.push('invalidMinimum')
    }
    return {
      row,
      issues,
      existing: material,
      stock,
      minimum,
      preserveStock: material !== undefined && withMovements?.has(material._id) === true
    }
  })
}

/** Shows only fields that the importer will actually change. */
export function importFieldChanges (
  row: StockImportRow,
  existing: Material | undefined
): Array<{ label: string, before: string, after: string }> {
  if (existing === undefined) return []
  const pairs: Array<[string, string | number | undefined | null, string | number | undefined | null]> = [
    ['编号', existing.code, row.code.trim()],
    ['名称', existing.name, row.name.trim()],
    ['型号', existing.model, row.model ?? ''],
    ['品牌', existing.brand, row.brand ?? ''],
    ['类别', existing.category, row.category ?? ''],
    ['组别', existing.group, row.group ?? ''],
    ['货架', existing.rack, row.rack ?? ''],
    ['层', existing.level, row.level ?? '']
  ]
  if (row.minimumPresent !== false) {
    pairs.push(['最低库存', existing.minimumStock, row.minimum.trim() === '' ? undefined : parseQuantity(row.minimum)])
  }
  return pairs
    .filter(([, oldValue, newValue]) => (oldValue ?? '') !== (newValue ?? ''))
    .map(([label, before, after]) => ({
      label,
      before: before === undefined || before === null || before === '' ? '—' : String(before),
      after: after === undefined || after === null || after === '' ? '—' : String(after)
    }))
}
