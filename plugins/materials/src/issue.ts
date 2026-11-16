// Copyright © 2026 Auraplex. Licensed under EPL-2.0.
import { normalizeCode, planMovement, type Material } from './index'
import type { ShortageRow } from './shortage'

export interface IssueItem {
  row: ShortageRow
  material: Material
  quantity: number
  delta: number
  balance: number
}
export interface IssueSkip {
  row: ShortageRow
  reasons: string[]
}
export interface IssuePlan {
  blocked: ShortageRow[]
  skipped: IssueSkip[]
  items: IssueItem[]
}

/** Prepare a batch without changing any inventory. */
export function planIssue (rows: ShortageRow[], materials: Material[]): IssuePlan {
  const blocked: ShortageRow[] = []
  const skipped: IssueSkip[] = []
  const items: IssueItem[] = []
  const matches = new Map<string, Material[]>()
  for (const material of materials) {
    const code = normalizeCode(material.normalizedCode)
    matches.set(code, [...(matches.get(code) ?? []), material])
  }
  const counts = new Map<string, number>()
  for (const row of rows) if (row.status === 'enough') counts.set(row.code, (counts.get(row.code) ?? 0) + 1)
  for (const row of rows) {
    if (row.status === 'shortage') {
      blocked.push(row)
      continue
    }
    if (row.status === 'problem') {
      skipped.push({ row, reasons: row.issues.length > 0 ? row.issues : ['物料数据有问题'] })
      continue
    }
    const candidates = matches.get(row.code) ?? []
    if (candidates.length !== 1 || (counts.get(row.code) ?? 0) > 1) {
      skipped.push({ row, reasons: [candidates.length === 0 ? '库存中找不到物料' : '物料编号重复，无法确定出库物料'] })
      continue
    }
    const material = candidates[0]
    const quantity = row.required
    if (
      quantity === undefined ||
      !Number.isFinite(material.stock) ||
      material.stock < 0 ||
      row.stock !== material.stock
    ) {
      skipped.push({ row, reasons: ['需要数量或库存无效，请重新计算'] })
      continue
    }
    const movement = planMovement(material.stock, 'out', quantity)
    if ('error' in movement) {
      const reasons =
        movement.error === 'Insufficient' ? ['库存不足，请重新计算'] : ['出库数量无效，须大于 0 且最多 3 位小数']
      skipped.push({ row, reasons })
      continue
    }
    items.push({ row, material, quantity, ...movement })
  }
  return { blocked, skipped, items }
}
