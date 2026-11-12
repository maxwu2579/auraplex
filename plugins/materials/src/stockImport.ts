// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0

import { normalizeCode, parseQuantity, type Material } from './index'

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
  existing: Material[]
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
    return { row, issues, existing: material, stock, minimum, preserveStock: (material?.movements ?? 0) > 0 }
  })
}
