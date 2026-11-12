// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import { bomDiff } from '../bomDiff'
import type { BomImportLine } from '../bomWorkbook'
const line = (code: string, section: string, qty: string): BomImportLine => ({
  code,
  section,
  quantityRaw: qty,
  quantityProblem: false,
  codeProblem: false,
  sourceRow: 1,
  sourceSheet: 'TEST',
  description: ''
})
test('retains repeated material in different sections and reports add, remove and quantity changes', () => {
  const old = [line('A', 'one', '1'), line('A', 'two', '2'), line('B', 'one', '1')]
  const next = [line('A', 'one', '3'), line('A', 'two', '2'), line('C', 'one', '1')]
  expect(bomDiff(old, next)).toEqual({ added: 1, removed: 1, quantityChanged: 1 })
})

test('equal numeric values are not reported as changed due to formatting', () => {
  const a = { ...line('A', 'one', '2'), quantity: 2 }
  const b = { ...line('A', 'one', '2.0'), quantity: 2 }
  expect(bomDiff([a], [b])).toEqual({ added: 0, removed: 0, quantityChanged: 0 })
})
