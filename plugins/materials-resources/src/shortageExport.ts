// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import { calculateShortages, type CalculationProduct, type ShortageRow, type Material } from '@hcengineering/materials'
import { createWorkbook, datedFilename, type Cell, type RowStyle, type Sheet } from './xlsx'
import { tt } from './tr'

type Stock = Pick<Material, 'normalizedCode' | 'name' | 'stock' | 'rack' | 'level'>
const names: Record<ShortageRow['status'], string> = { shortage: tt('缺料'), problem: tt('有问题'), enough: tt('够用') }
const colours: Record<ShortageRow['status'], RowStyle> = { shortage: 'red', problem: 'yellow', enough: undefined }
const headings = [tt('状态'), tt('编号'), tt('名称'), tt('需要'), tt('库存'), tt('缺多少'), tt('位置（货架 / 层）'), tt('用于产品和装配段'), tt('问题')]
function sheetFor (name: string, rows: ShortageRow[]): Sheet {
  return {
    name,
    rows: [
      headings,
      ...rows.map((r): Cell[] => [
        names[r.status],
        r.code,
        r.name,
        r.required ?? tt('未知'),
        r.assumedZero ? tt('未知（按 0 估算）') : (r.stock ?? tt('未知')),
        r.shortage ?? tt('未知'),
        [r.rack, r.level].filter(Boolean).join(' / '),
        r.uses
          .map(
            (u) =>
              `${u.product} × ${u.count} / ${u.section !== '' ? u.section : tt('未指定装配段')}：${u.required ?? tt('未知')}`
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
  const sheets: Sheet[] = [sheetFor(tt('物料明细'), combined)]
  if (products.length === 1) {
    sheets.push(
      sheetFor(
        tt('缺料表'),
        combined.filter((r) => r.status === 'shortage')
      )
    )
    sheets.push(
      sheetFor(
        tt('问题表'),
        combined.filter((r) => r.status === 'problem')
      )
    )
  } else {
    const summary: Cell[][] = [[tt('产品'), tt('台数'), tt('缺料项'), tt('问题项'), tt('够用项')]]
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
    sheets.push({ name: tt('汇总'), rows: summary })
    for (const product of products) {
      sheets.push(sheetFor(product.name, byStatus(calculateShortages([product], materials))))
    }
  }
  return createWorkbook(sheets)
}
export function shortageFilename (products: CalculationProduct[], date: Date): string {
  const title = products.map((p) => p.name).join('_')
  return datedFilename(tt('缺料计算'), title !== '' ? title : tt('产品'), date)
}
