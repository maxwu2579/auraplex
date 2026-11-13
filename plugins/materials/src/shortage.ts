// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import Decimal from 'decimal.js'
import { normalizeCode, type BomLine, type Material } from './index'

const Exact = Decimal.clone({ precision: 40 })
export type ShortageStatus = 'shortage' | 'problem' | 'enough'
export interface ShortageUse {
  product: string
  count: number
  section: string
  quantity?: number
  required?: number
}
export interface ShortageRow {
  code: string
  name: string
  required?: number
  stock?: number
  shortage?: number
  assumedZero: boolean
  rack: string
  level: string
  status: ShortageStatus
  issues: string[]
  uses: ShortageUse[]
}
export interface CalculationProduct {
  id: string
  name: string
  count: number
  lines: Array<
  Pick<BomLine, 'code' | 'description' | 'quantity' | 'quantityProblem' | 'codeProblem' | 'section' | 'sourceRow'>
  >
}
type Stock = Pick<Material, 'normalizedCode' | 'name' | 'stock' | 'rack' | 'level'>

/** Pure calculation: unknown or invalid quantities never become a confident shortage or zero demand. */
export function calculateShortages (products: CalculationProduct[], materials: Stock[]): ShortageRow[] {
  if (products.length === 0) throw new Error('请至少选择一个产品')
  if (new Set(products.map((p) => p.id)).size !== products.length) throw new Error('产品不能重复选择')
  const stock = new Map<string, Stock[]>()
  for (const item of materials) {
    const key = normalizeCode(item.normalizedCode)
    if (key === '') continue
    const group = stock.get(key) ?? []
    group.push(item)
    stock.set(key, group)
  }
  const grouped = new Map<
  string,
  { code: string, name: string, invalidCode: boolean, invalidQuantity: boolean, total: Decimal, uses: ShortageUse[] }
  >()
  for (const product of products) {
    if (!Number.isSafeInteger(product.count) || product.count <= 0) throw new Error('台数必须为大于零的整数')
    if (product.lines.length === 0) throw new Error(`产品 ${product.name} 没有 BOM 明细`)
    for (const [index, line] of product.lines.entries()) {
      const code = normalizeCode(line.code)
      const invalidCode = line.codeProblem || code === ''
      const key = invalidCode
        ? JSON.stringify(['invalid', product.id, line.sourceRow, index])
        : JSON.stringify(['code', code])
      const item = grouped.get(key) ?? {
        code,
        name: line.description,
        invalidCode,
        invalidQuantity: false,
        total: new Exact(0),
        uses: []
      }
      const quantity = line.quantity
      const invalidQuantity =
        line.quantityProblem || quantity === undefined || !Number.isFinite(quantity) || quantity <= 0
      const required = invalidQuantity ? undefined : new Exact(quantity).mul(product.count)
      item.invalidQuantity ||= invalidQuantity
      if (required !== undefined) item.total = item.total.plus(required)
      const requiredNumber = required?.toNumber()
      if (requiredNumber !== undefined && !Number.isFinite(requiredNumber)) item.invalidQuantity = true
      item.uses.push({
        product: product.name,
        count: product.count,
        section: line.section,
        ...(invalidQuantity ? {} : { quantity }),
        ...(requiredNumber === undefined || !Number.isFinite(requiredNumber) ? {} : { required: requiredNumber })
      })
      grouped.set(key, item)
    }
  }
  const result: ShortageRow[] = []
  for (const item of grouped.values()) {
    const records = item.invalidCode ? [] : (stock.get(item.code) ?? [])
    const issues: string[] = []
    if (item.invalidCode) issues.push('物料编号无效')
    if (item.invalidQuantity) issues.push('BOM 数量为零或无效')
    if (!item.invalidCode && records.length === 0) issues.push('库存中找不到，按 0 估算')
    if (records.length > 1) issues.push('库存编号重复，无法确定库存')
    const one = records.length === 1 ? records[0] : undefined
    const validStock = one !== undefined && Number.isFinite(one.stock) && one.stock >= 0
    if (one !== undefined && !validStock) issues.push('库存数字无效，按 0 估算')
    const total = item.total.toNumber()
    if (!Number.isFinite(total)) issues.push('需要数量过大')
    const required = item.invalidQuantity || !Number.isFinite(total) ? undefined : total
    const assumedZero = (!item.invalidCode && records.length === 0) || (one !== undefined && !validStock)
    const stockValue = validStock ? one?.stock : undefined
    const calculatedStock = validStock ? stockValue : assumedZero ? 0 : undefined
    const diff =
      required !== undefined && calculatedStock !== undefined ? new Exact(required).minus(calculatedStock) : undefined
    const shortage = diff === undefined ? undefined : Decimal.max(diff, 0).toNumber()
    result.push({
      code: item.code,
      name: one?.name ?? item.name,
      required,
      stock: stockValue,
      shortage,
      assumedZero,
      rack: one?.rack ?? '',
      level: one?.level ?? '',
      status: issues.length > 0 ? 'problem' : (shortage ?? 0) > 0 ? 'shortage' : 'enough',
      issues,
      uses: item.uses
    })
  }
  const rank: Record<ShortageStatus, number> = { shortage: 0, problem: 1, enough: 2 }
  return result.sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status]
    return byStatus !== 0 ? byStatus : a.code.localeCompare(b.code)
  })
}
