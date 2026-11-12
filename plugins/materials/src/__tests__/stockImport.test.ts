// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0

import { previewStockRows, type StockImportRow } from '../stockImport'
import type { Material } from '../index'

const row = (code: string, stock = '3'): StockImportRow => ({ row: 14, code, stock, name: 'Example', minimum: '' })

describe('stock import preview', () => {
  it('flags normalized duplicates without combining quantities', () => {
    const result = previewStockRows([row(' test-01 '), row('ＴＥＳＴ-01', '5')], [])
    expect(result.map((item) => item.issues)).toEqual([['duplicateCode'], ['duplicateCode']])
    expect(result.map((item) => item.stock)).toEqual([3, 5])
  })
  it('distinguishes missing and invalid stock from zero', () => {
    const result = previewStockRows([row('A', ''), row('B', 'unknown'), row('C', '0')], [])
    expect(result.map((item) => item.issues)).toEqual([['blankStock'], ['invalidStock'], []])
    expect(result.map((item) => item.stock)).toEqual([undefined, undefined, 0])
  })
  it('identifies materials with movement history', () => {
    const existing = { normalizedCode: 'A', movements: 1, stock: 7 } as unknown as Material
    expect(previewStockRows([row('a', '2')], [existing])[0].preserveStock).toBe(true)
  })
})
