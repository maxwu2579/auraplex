// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import { strFromU8, unzipSync } from 'fflate'
import type { CalculationProduct, Material } from '@hcengineering/materials'
import { createShortageWorkbook, shortageFilename } from '../shortageExport'
const item: CalculationProduct = {
  id: 'a',
  name: 'A/TEST',
  count: 2,
  lines: [
    {
      code: 'X',
      description: '=not-a-formula',
      quantity: 2,
      quantityProblem: false,
      codeProblem: false,
      section: 'test',
      sourceRow: 1
    },
    {
      code: 'MISSING',
      description: 'missing',
      quantity: 1,
      quantityProblem: false,
      codeProblem: false,
      section: 'test',
      sourceRow: 2
    }
  ]
}
const stock: Array<Pick<Material, 'normalizedCode' | 'name' | 'stock' | 'rack' | 'level'>> = [
  { normalizedCode: 'X', name: '=not-a-formula', stock: 1, rack: '', level: '' }
]
test('single product exports shortage and problem sheets using safe literal strings', () => {
  const files = unzipSync(createShortageWorkbook([item], stock))
  const workbook = strFromU8(files['xl/workbook.xml'])
  const first = strFromU8(files['xl/worksheets/sheet1.xml'])
  const second = strFromU8(files['xl/worksheets/sheet2.xml'])
  expect(workbook).toContain('缺料表')
  expect(workbook).toContain('问题表')
  expect(first).toContain('=not-a-formula')
  expect(first).not.toContain('<f>')
  expect(second).toContain('未知（按 0 估算）')
})
test('multiple products use unique valid sheet names and a dated safe filename', () => {
  const products = [item, { ...item, id: 'b', name: 'A:TEST' }]
  const workbook = strFromU8(unzipSync(createShortageWorkbook(products, stock))['xl/workbook.xml'])
  expect(workbook).toContain('汇总')
  expect(workbook).toContain('合并')
  expect(workbook).toContain('A_TEST')
  expect(workbook).toContain('A_TEST (2)')
  expect(shortageFilename(products, new Date(2026, 10, 13))).toContain('2026-11-13.xlsx')
})
