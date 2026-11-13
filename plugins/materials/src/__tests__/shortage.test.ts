// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import { calculateShortages, type CalculationProduct } from '../shortage'
import type { Material } from '../index'
const stock = (
  code: string,
  quantity: number
): Pick<Material, 'normalizedCode' | 'name' | 'stock' | 'rack' | 'level'> => ({
  normalizedCode: code,
  name: code,
  stock: quantity,
  rack: 'R',
  level: '1'
})
const line = (code: string, quantity: number | undefined, section = ''): CalculationProduct['lines'][number] => ({
  code,
  description: code,
  quantity,
  quantityProblem: quantity === undefined || quantity <= 0,
  codeProblem: false,
  section,
  sourceRow: 1
})
const product = (id: string, count: number, lines: CalculationProduct['lines']): CalculationProduct => ({
  id,
  name: id,
  count,
  lines
})
test('original single-product arithmetic: 2 per unit × 3 uses 6 of 10', () => {
  const r = calculateShortages([product('A', 3, [line('a-01-k', 2)])], [stock('A-01-K', 10)])[0]
  expect([r.required, r.stock, r.shortage, r.status]).toEqual([6, 10, 0, 'enough'])
})
test('original multi-product example combines 2×2 + 3×3 = 13 of 10', () => {
  const r = calculateShortages(
    [product('A', 2, [line('SHARED', 2)]), product('B', 3, [line('SHARED', 3)])],
    [stock('SHARED', 10)]
  )[0]
  expect([r.required, r.stock, r.shortage, r.status]).toEqual([13, 10, 3, 'shortage'])
})
test('same code across assembly sections is summed as explicitly requested', () => {
  const r = calculateShortages(
    [product('A', 2, [line('PART', 2, 'one'), line('PART', 3, 'two')])],
    [stock('PART', 9)]
  )[0]
  expect([r.required, r.shortage, r.status, r.uses.length]).toEqual([10, 1, 'shortage', 2])
})
test('missing material stays yellow with an explicitly labelled assumed zero', () => {
  const r = calculateShortages([product('A', 3, [line('MISSING', 1)])], [])[0]
  expect([r.required, r.stock, r.shortage, r.status, r.assumedZero]).toEqual([3, undefined, 3, 'problem', true])
})
test('invalid quantity or duplicate stock never becomes a confident shortage', () => {
  const rows = calculateShortages(
    [product('A', 1, [line('BAD', 0), line('DUP', 1)])],
    [stock('BAD', 1), stock('DUP', 3), stock('DUP', 4)]
  )
  expect(rows.every((r) => r.status === 'problem' && r.shortage === undefined)).toBe(true)
  expect(rows.find((r) => r.code === 'BAD')?.required).toBeUndefined()
})
test('invalid quantity in a combined material keeps the total unknown', () => {
  const r = calculateShortages(
    [product('A', 1, [line('X', 2)]), product('B', 1, [line('X', undefined)])],
    [stock('X', 1)]
  )[0]
  expect([r.required, r.shortage, r.status]).toEqual([undefined, undefined, 'problem'])
})
test('zero stock is valid, decimals are exact, and rows sort red yellow white', () => {
  const rows = calculateShortages(
    [product('A', 3, [line('WHITE', 1), line('RED', 1), line('MISS', 1), line('DEC', 0.1), line('DEC', 0.2)])],
    [stock('WHITE', 20), stock('RED', 0), stock('DEC', 0.9)]
  )
  expect(rows.map((r) => r.status)).toEqual(['shortage', 'problem', 'enough', 'enough'])
  expect(rows.find((r) => r.code === 'DEC')?.required).toBe(0.9)
})
test('only positive whole product counts are allowed', () => {
  for (const n of [0, -1, 1.5, NaN]) expect(() => calculateShortages([product('A', n, [line('X', 1)])], [])).toThrow()
})

test('accepted fake A×2 and A×1 plus B×3 match the recorded fixture', () => {
  const a = [
    line('SAMPLE-001', 4, 'A'),
    line('SAMPLE-002', 0, 'A'),
    line('SAMPLE-001', 3, 'B'),
    line('SAMPLE-003', 1, 'B')
  ]
  const b = [
    line('SAMPLE-001', 2, 'A'),
    line('SAMPLE-002', 0, 'A'),
    line('SAMPLE-001', 3, 'B'),
    line('SAMPLE-NOT-IN-STOCK', 1, 'B')
  ]
  const items = [
    stock('SAMPLE-001', 1),
    stock('SAMPLE-002', 2),
    stock('SAMPLE-003', 3),
    stock('SAMPLE-NOT-IN-STOCK', 5)
  ]
  const one = calculateShortages([product('A', 2, a)], items)
  expect(one.map((r) => [r.code, r.status, r.required, r.shortage])).toEqual([
    ['SAMPLE-001', 'shortage', 14, 13],
    ['SAMPLE-002', 'problem', undefined, undefined],
    ['SAMPLE-003', 'enough', 2, 0]
  ])
  const multi = calculateShortages([product('A', 1, a), product('B', 3, b)], items)
  expect(multi.map((r) => [r.code, r.status, r.required, r.shortage])).toEqual([
    ['SAMPLE-001', 'shortage', 22, 21],
    ['SAMPLE-002', 'problem', undefined, undefined],
    ['SAMPLE-003', 'enough', 1, 0],
    ['SAMPLE-NOT-IN-STOCK', 'enough', 3, 0]
  ])
})

test('externally purchased Assy is treated as one normal material and not expanded', () => {
  const result = calculateShortages([product('A', 2, [line('ASSY-TEST', 3)])], [stock('ASSY-TEST', 5)])
  expect(result).toHaveLength(1)
  expect([result[0].code, result[0].required, result[0].shortage, result[0].status]).toEqual([
    'ASSY-TEST',
    6,
    1,
    'shortage'
  ])
})
test('invalid material codes cannot silently match inventory', () => {
  const bad = { ...line('PART', 1), codeProblem: true }
  const result = calculateShortages([product('A', 1, [bad])], [stock('PART', 8)])[0]
  expect([result.status, result.stock, result.shortage]).toEqual(['problem', undefined, undefined])
})

test('original invalid-stock example uses a clearly flagged assumed zero', () => {
  const result = calculateShortages([product('A', 3, [line('BAD-STOCK', 1)])], [stock('BAD-STOCK', NaN)])[0]
  expect([result.required, result.stock, result.shortage, result.status, result.assumedZero]).toEqual([
    3,
    undefined,
    3,
    'problem',
    true
  ])
})
