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
test('single product opens on the full material list, then shortage and problem sheets, as literal strings', () => {
  const files = unzipSync(createShortageWorkbook([item], stock))
  const workbook = strFromU8(files['xl/workbook.xml'])
  const all = strFromU8(files['xl/worksheets/sheet1.xml'])
  const shortages = strFromU8(files['xl/worksheets/sheet2.xml'])
  const problems = strFromU8(files['xl/worksheets/sheet3.xml'])
  expect(workbook.indexOf('物料明细')).toBeLessThan(workbook.indexOf('缺料表'))
  expect(workbook).toContain('问题表')
  expect(all).toContain('=not-a-formula')
  expect(all).toContain('未知（按 0 估算）')
  expect(shortages).toContain('=not-a-formula')
  expect(shortages).not.toContain('<f>')
  expect(problems).toContain('未知（按 0 估算）')
})
test('multiple products use unique valid sheet names and a dated safe filename', () => {
  const products = [item, { ...item, id: 'b', name: 'A:TEST' }]
  const workbook = strFromU8(unzipSync(createShortageWorkbook(products, stock))['xl/workbook.xml'])
  expect(workbook).toContain('汇总')
  expect(workbook.indexOf('物料明细')).toBeLessThan(workbook.indexOf('汇总'))
  expect(workbook).toContain('A_TEST')
  expect(workbook).toContain('A_TEST (2)')
  expect(shortageFilename(products, new Date(2026, 10, 13))).toContain('2026-11-13.xlsx')
})
