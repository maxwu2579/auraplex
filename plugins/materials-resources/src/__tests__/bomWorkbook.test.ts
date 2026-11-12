// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import { DOMParser as XMLParser } from '@xmldom/xmldom'
import { strToU8, zipSync } from 'fflate'
import { readBomWorkbook } from '../bomWorkbook'
globalThis.DOMParser = XMLParser as unknown as typeof DOMParser
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const c = (ref: string, text: string): string => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`
const sheet = `<worksheet><row r="18">${c('D18','PART NO')}${c('E18','DESCRIPTION')}${c('L18','QTY')}</row><row r="19">${c('B19','ASSY NAME:')}${c('E19','Section A')}</row><row r="20">${c('D20',' sample-001 ')}${c('E20','Fake')}<c r="L20"><v>0</v></c></row><row r="21">${c('B21','ASSY NAME:')}${c('E21','Section B')}</row><row r="22">${c('D22','SAMPLE-001')}${c('E22','Fake')}${c('L22','bad')}</row></worksheet>`
const zip = (): Uint8Array => zipSync({
 'xl/workbook.xml': strToU8(`<workbook xmlns:r="${r}"><sheet name="TEST PRODUCT" r:id="a"/><sheet name="BOM TEMPLATE" r:id="b"/></workbook>`),
 'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="a" Target="worksheets/sheet1.xml"/><Relationship Id="b" Target="worksheets/sheet2.xml"/></Relationships>'),
 'xl/worksheets/sheet1.xml': strToU8(sheet), 'xl/worksheets/sheet2.xml': strToU8(sheet), 'xl/media/ignored.png': new Uint8Array([1,2,3])
})
test('keeps zero and invalid quantities and repeated codes in different sections; ignores template', () => {
 const products=readBomWorkbook(zip()); expect(products).toHaveLength(1)
 const lines=products[0].lines; expect(lines.map(x=>x.code)).toEqual(['SAMPLE-001','SAMPLE-001'])
 expect(lines.map(x=>x.section)).toEqual(['Section A','Section B'])
 expect(lines.map(x=>x.quantityProblem)).toEqual([true,true]); expect(lines[0].quantity).toBe(0); expect(lines[1].quantity).toBeUndefined()
})
