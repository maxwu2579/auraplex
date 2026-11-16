// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import { calculateShortages, type CalculationProduct, type ShortageRow, type Material } from '@hcengineering/materials'
import { createWorkbook, datedFilename, type Cell, type RowStyle, type Sheet } from './xlsx'

type Stock = Pick<Material, 'normalizedCode' | 'name' | 'stock' | 'rack' | 'level'>
const names: Record<ShortageRow['status'], string> = { shortage: '缺料', problem: '有问题', enough: '够用' }
const colours: Record<ShortageRow['status'], RowStyle> = { shortage: 'red', problem: 'yellow', enough: undefined }
const headings = ['状态', '编号', '名称', '需要', '库存', '缺多少', '位置（货架 / 层）', '用于产品和装配段', '问题']
function sheetFor (name: string, rows: ShortageRow[]): Sheet {
  return {
    name,
    rows: [
      headings,
      ...rows.map((r): Cell[] => [
        names[r.status],
        r.code,
        r.name,
        r.required ?? '未知',
        r.assumedZero ? '未知（按 0 估算）' : (r.stock ?? '未知'),
        r.shortage ?? '未知',
        [r.rack, r.level].filter(Boolean).join(' / '),
        r.uses
          .map(
            (u) =>
              `${u.product} × ${u.count} / ${u.section !== '' ? u.section : '未指定装配段'}：${u.required ?? '未知'}`
          )
          .join('；'),
        r.issues.join('；')
      ])
    ],
    styles: [undefined, ...rows.map((r) => colours[r.status])]
  }
}
/**
 * The first sheet, the one Excel opens on, is the full material list: every material with what is needed,
 * what is in stock and how many are missing (several products are added together). Shortages come first.
 * One product: then the shortage and problem sheets. Several products: then a summary and one sheet per product.
 */
const order: Record<ShortageRow['status'], number> = { shortage: 0, problem: 1, enough: 2 }
function byStatus (rows: ShortageRow[]): ShortageRow[] {
  // Array sort is stable, so rows keep their order within each status.
  return [...rows].sort((a, b) => order[a.status] - order[b.status])
}
export function createShortageWorkbook (products: CalculationProduct[], materials: Stock[]): Uint8Array {
  const combined = byStatus(calculateShortages(products, materials))
  const sheets: Sheet[] = [sheetFor('物料明细', combined)]
  if (products.length === 1) {
    sheets.push(
      sheetFor(
        '缺料表',
        combined.filter((r) => r.status === 'shortage')
      )
    )
    sheets.push(
      sheetFor(
        '问题表',
        combined.filter((r) => r.status === 'problem')
      )
    )
  } else {
    const summary: Cell[][] = [['产品', '台数', '缺料项', '问题项', '够用项']]
    for (const product of products) {
      const rows = calculateShortages([product], materials)
      summary.push([
        product.name,
        product.count,
        rows.filter((r) => r.status === 'shortage').length,
        rows.filter((r) => r.status === 'problem').length,
        rows.filter((r) => r.status === 'enough').length
      ])
    }
    sheets.push({ name: '汇总', rows: summary })
    for (const product of products) {
      sheets.push(sheetFor(product.name, byStatus(calculateShortages([product], materials))))
    }
  }
  return createWorkbook(sheets)
}
export function shortageFilename (products: CalculationProduct[], date: Date): string {
  const title = products.map((p) => p.name).join('_')
  return datedFilename('缺料计算', title !== '' ? title : '产品', date)
}
