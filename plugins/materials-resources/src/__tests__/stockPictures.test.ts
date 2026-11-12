// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import { DOMParser as XMLParser } from '@xmldom/xmldom'
import { strToU8, zipSync } from 'fflate'
import { indexStockPictures } from '../stockPictures'
globalThis.DOMParser = XMLParser as unknown as typeof DOMParser
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const type = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const relationships = (items: Array<[string, string, string]>): string =>
  `<Relationships>${items.map(([id, kind, target]) => `<Relationship Id="${id}" Type="${type}${kind}" Target="${target}"/>`).join('')}</Relationships>`
function fixture (broken = false): Uint8Array {
  const files: Record<string, string> = {
    'xl/workbook.xml': `<workbook xmlns:r="${r}"><sheet name="AURA STOCK MAP-V2-K" r:id="s"/></workbook>`,
    'xl/_rels/workbook.xml.rels': relationships([
      ['s', 'worksheet', 'worksheets/sheet1.xml'],
      ['m', 'sheetMetadata', 'metadata.xml'],
      ['v', 'rdRichValue', 'richData/rdrichvalue.xml'],
      ['t', 'rdRichValueStructure', 'richData/rdrichvaluestructure.xml'],
      ['l', 'richValueRel', 'richData/richValueRel.xml']
    ]),
    'xl/worksheets/sheet1.xml': '<worksheet><row><c r="D14" vm="1"/><c r="D15" vm="2"/></row></worksheet>',
    'xl/worksheets/_rels/sheet1.xml.rels': relationships([['d', 'drawing', '../drawings/drawing1.xml']]),
    'xl/metadata.xml':
      '<metadata><metadataType name="XLRICHVALUE"/><futureMetadata name="XLRICHVALUE"><bk><rvb i="0"/></bk><bk><rvb i="1"/></bk></futureMetadata><valueMetadata><bk><rc t="1" v="0"/></bk><bk><rc t="1" v="1"/></bk></valueMetadata></metadata>',
    'xl/richData/rdrichvaluestructure.xml':
      '<structures><s t="_localImage"><k n="_rvRel:LocalImageIdentifier"/></s></structures>',
    'xl/richData/rdrichvalue.xml': '<values><rv s="0"><v>0</v></rv><rv s="0"><v>1</v></rv></values>',
    'xl/richData/richValueRel.xml': `<relations xmlns:r="${r}"><rel r:id="i1"/><rel r:id="i2"/></relations>`,
    'xl/richData/_rels/richValueRel.xml.rels': relationships([
      ['i1', 'image', '../media/a.png'],
      ['i2', 'image', broken ? '../media/missing.png' : '../media/b.png']
    ]),
    'xl/drawings/drawing1.xml': `<drawing xmlns:r="${r}"><twoCellAnchor><from><row>15</row><col>3</col></from><pic><blip r:embed="f"/></pic></twoCellAnchor></drawing>`,
    'xl/drawings/_rels/drawing1.xml.rels': relationships([['f', 'image', '../media/c.png']])
  }
  const entries: Record<string, Uint8Array> = Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, strToU8(text)])
  )
  entries['xl/media/a.png'] = new Uint8Array([1])
  entries['xl/media/b.png'] = new Uint8Array([2])
  entries['xl/media/c.png'] = new Uint8Array([3])
  return zipSync(entries)
}
test('indexes in-cell and anchored pictures by row without unpacking media', () => {
  expect(indexStockPictures(fixture())).toEqual([
    { row: 14, cell: 'D14', kind: 'IN_CELL', media: 'xl/media/a.png' },
    { row: 15, cell: 'D15', kind: 'IN_CELL', media: 'xl/media/b.png' },
    { row: 16, cell: 'D16', kind: 'FLOATING', media: 'xl/media/c.png' }
  ])
})
test('reports a missing image instead of guessing', () => {
  expect(indexStockPictures(fixture(true))[1]).toEqual({
    row: 15,
    cell: 'D15',
    kind: 'IN_CELL',
    problem: 'TARGET_MISSING'
  })
})
