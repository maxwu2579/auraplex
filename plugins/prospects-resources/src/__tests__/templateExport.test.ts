// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import { defaultProspectFields, type Prospect, type ProspectFieldDef } from '@hcengineering/prospects'
import { strFromU8, unzipSync } from 'fflate'
import { createWorkbook, prospectTemplateColumns } from '../xlsx'

test('the Excel worksheet follows template order and labels and skips hidden fields', () => {
  const date: ProspectFieldDef = {
    key: 'c_visit', label: 'Visit date', builtin: false, hidden: false, type: 'date', order: 0
  }
  const fields = [date, ...defaultProspectFields.map((field) => ({
    ...field,
    label: field.key === 'name' ? 'Contact' : field.key,
    hidden: !['name', 'company'].includes(field.key),
    order: field.order + 1
  }))]
  const prospect = {
    name: 'Sample Person',
    company: 'Sample Company',
    email: 'sample@example.test',
    custom: { c_visit: Date.UTC(2026, 10, 27), c_removed: 'archived value' }
  } as unknown as Prospect
  const columns = prospectTemplateColumns(fields, (field) => field.label)
  const workbook = createWorkbook([{
    name: 'Cards',
    rows: [columns.map((column) => column.label), columns.map((column) => column.read(prospect))]
  }])
  const xml = strFromU8(unzipSync(workbook)['xl/worksheets/sheet1.xml'])
  expect(columns.map((column) => column.label)).toEqual(['Visit date', 'Contact', 'company'])
  expect(xml).toMatch(/r="A2"[^>]*.*2026-11-27.*r="B2"[^>]*.*Sample Person.*r="C2"[^>]*.*Sample Company/)
  expect(xml).not.toMatch(/sample@example\.test|archived value/)
})
