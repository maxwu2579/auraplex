// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0

import { DOMParser as XMLParser } from '@xmldom/xmldom'
import { strToU8, zipSync } from 'fflate'
import { readStockWorkbook } from '../stockWorkbook'

globalThis.DOMParser = XMLParser as unknown as typeof DOMParser
const cell = (ref: string, text: string): string => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`
const row = (number: number, content: string): string => `<row r="${number}">${content}</row>`
function workbook (): Uint8Array {
  const head = ['E:PART NO', 'F:DESCRIPTION', 'K:RACKING', 'L:LEVEL', 'O:LIVE STOCK', 'P:MIIN QTY']
    .map((item) => {
      const [col, value] = item.split(':')
      return cell(`${col}13`, value)
    })
    .join('')
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${row(13, head)}${row(14, cell('E14', 'TEST-A') + cell('F14', 'Fake part') + '<c r="O14"><v>4</v></c>')}${row(15, cell('A15', 'GROUND FLOOR') + cell('E15', 'Section'))}${row(16, cell('E16', 'TEST-B') + cell('F16', 'Other') + '<c r="O16"><f>1+1</f><v>2</v></c>')}</sheetData></worksheet>`
  return zipSync({
    'xl/workbook.xml': strToU8(
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="AURA STOCK MAP-V2-K" r:id="rId1"/></sheets></workbook>'
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/media/ignored.png': new Uint8Array([1, 2, 3])
  })
}
test('reads rows, skips area headings and marks formula stock', () => {
  const rows = readStockWorkbook(workbook())
  expect(rows.map((r) => r.code)).toEqual(['TEST-A', 'TEST-B'])
  expect(rows[0].stock).toBe('4')
  expect(rows[1].invalidStockCell).toBe(true)
})
