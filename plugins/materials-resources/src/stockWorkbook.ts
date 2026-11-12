// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0

import { unzipSync, strFromU8 } from 'fflate'
import { normalizeCode } from '@hcengineering/materials'
import type { StockImportRow } from '@hcengineering/materials'

const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function xml (bytes: Uint8Array | undefined): Document {
  if (bytes === undefined) throw new Error('Excel 文件缺少必要部分')
  const doc = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('Excel 文件格式有误')
  return doc
}
function elements (node: Document | Element, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS('*', name))
}
function normalizedPath (value: string): string {
  const result: string[] = []
  for (const part of value.split('/')) {
    if (part === '..') result.pop()
    else if (part !== '' && part !== '.') result.push(part)
  }
  return result.join('/')
}
function relationships (doc: Document): Map<string, string> {
  const result = new Map<string, string>()
  for (const item of elements(doc, 'Relationship')) {
    const id = item.getAttribute('Id')
    const target = item.getAttribute('Target')
    if (id !== null && target !== null && item.getAttribute('TargetMode') !== 'External') {
      result.set(id, normalizedPath(target.startsWith('/') ? target : `xl/${target}`))
    }
  }
  return result
}

/** Reads only the target worksheet and shared strings; media are never decompressed. */
export function readStockWorkbook (data: Uint8Array): StockImportRow[] {
  const fixed = new Set(['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml'])
  const parts = unzipSync(data, { filter: (file) => fixed.has(file.name) })
  const workbook = xml(parts['xl/workbook.xml'])
  const links = relationships(xml(parts['xl/_rels/workbook.xml.rels']))
  const sheet = elements(workbook, 'sheet').find((item) => item.getAttribute('name') === 'AURA STOCK MAP-V2-K')
  if (sheet === undefined) throw new Error('未找到 AURA STOCK MAP-V2-K 工作表')
  const id = sheet.getAttributeNS(rel, 'id')
  const target = id === null ? undefined : links.get(id)
  if (target === undefined) throw new Error('工作表链接无效')
  const worksheet = xml(unzipSync(data, { filter: (file) => file.name === target })[target])
  const shared =
    parts['xl/sharedStrings.xml'] === undefined
      ? []
      : elements(xml(parts['xl/sharedStrings.xml']), 'si').map((item) =>
        elements(item, 't')
          .map((t) => t.textContent ?? '')
          .join('')
      )
  interface Cell {
    text: string
    type: string
    formula: boolean
  }
  const parsed = elements(worksheet, 'row').map((item) => {
    const cells: Record<string, Cell> = {}
    for (const cell of elements(item, 'c')) {
      const column = /^([A-Z]+)/.exec(cell.getAttribute('r') ?? '')?.[1]
      if (column === undefined) continue
      const type = cell.getAttribute('t') ?? 'n'
      const value = elements(cell, 'v')[0]?.textContent ?? ''
      const text =
        type === 's'
          ? (shared[Number(value)] ?? '')
          : type === 'inlineStr'
            ? elements(cell, 't')
              .map((t) => t.textContent ?? '')
              .join('')
            : value
      cells[column] = { text, type, formula: elements(cell, 'f').length > 0 }
    }
    return { number: Number(item.getAttribute('r')), cells }
  })
  const value = (cells: Record<string, Cell>, column: string): string => cells[column]?.text ?? ''
  const header = parsed.findIndex(
    (row) =>
      row.number <= 100 &&
      [
        ['E', 'PART NO'],
        ['F', 'DESCRIPTION'],
        ['K', 'RACKING'],
        ['L', 'LEVEL'],
        ['O', 'LIVE STOCK']
      ].every(([column, label]) => normalizeCode(value(row.cells, column)) === label)
  )
  if (header < 0) throw new Error('前 100 行找不到库存表头')
  const headerCells = parsed[header].cells
  const minimumColumns = Object.keys(headerCells).filter((key) =>
    ['MIN QTY', 'MIIN QTY'].includes(normalizeCode(value(headerCells, key)))
  )
  if (minimumColumns.length > 1) throw new Error('发现多个最低库存列，请先整理表头')
  const minColumn = minimumColumns[0]
  const result: StockImportRow[] = []
  for (const row of parsed.slice(header + 1)) {
    const c = row.cells
    const get = (col: string): string => value(c, col)
    if (normalizeCode(get('B')) === 'ASSY NAME:') continue
    const area =
      ['GROUND FLOOR', 'MEZZANITE FLOOR', 'MEZZANINE FLOOR'].includes(normalizeCode(get('A'))) &&
      ['F', 'K', 'L', 'O'].every((key) => get(key) === '')
    if (area) continue
    const material =
      get('E') !== '' ||
      (get('F') !== '' &&
        ((get('A') !== '' && Number.isFinite(Number(get('A')))) || ['K', 'L', 'O'].some((key) => get(key) !== '')))
    if (!material) continue
    const bad = (key: string): boolean => c[key]?.formula || c[key]?.type === 'e'
    result.push({
      row: row.number,
      code: get('E'),
      name: get('F'),
      model: get('B'),
      brand: get('C'),
      category: get('G'),
      group: get('H'),
      rack: get('K'),
      level: get('L'),
      stock: get('O'),
      minimum: minColumn === undefined ? '' : get(minColumn),
      minimumPresent: minColumn !== undefined,
      invalidCode: bad('E') || !['s', 'inlineStr', 'str'].includes(c.E?.type ?? ''),
      invalidStockCell: bad('O'),
      invalidMinimumCell: minColumn !== undefined && bad(minColumn)
    })
  }
  return result
}
