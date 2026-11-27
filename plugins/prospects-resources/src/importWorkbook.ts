// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// Read the first sheet of an .xlsx file (or a .csv) as rows of text, for importing customers.
// Only the sheet itself and its shared strings are unpacked; pictures are never decompressed.
import { strFromU8, unzipSync } from 'fflate'

const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function xml (bytes: Uint8Array | undefined): Document {
  if (bytes === undefined) throw new Error('broken-file')
  const doc = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('broken-file')
  return doc
}
const elements = (node: Document | Element, name: string): Element[] => Array.from(node.getElementsByTagNameNS('*', name))

function columnIndex (letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64
  return n - 1
}

function readXlsx (data: Uint8Array): string[][] {
  const fixed = new Set(['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml'])
  const parts = unzipSync(data, { filter: (file) => fixed.has(file.name) })
  const workbook = xml(parts['xl/workbook.xml'])
  const links = new Map(elements(xml(parts['xl/_rels/workbook.xml.rels']), 'Relationship')
    .map((item) => [item.getAttribute('Id') ?? '', item.getAttribute('Target') ?? ''] as const))
  const sheet = elements(workbook, 'sheet')[0]
  const target = links.get(sheet?.getAttributeNS(rel, 'id') ?? '')
  if (target === undefined || target === '') throw new Error('no-sheet')
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  const worksheet = xml(unzipSync(data, { filter: (file) => file.name === path })[path])
  const shared = parts['xl/sharedStrings.xml'] === undefined
    ? []
    : elements(xml(parts['xl/sharedStrings.xml']), 'si').map((item) => elements(item, 't').map((t) => t.textContent ?? '').join(''))
  const rows: string[][] = []
  for (const row of elements(worksheet, 'row')) {
    const number = Number(row.getAttribute('r'))
    const cells: string[] = []
    for (const cell of elements(row, 'c')) {
      const letters = /^([A-Z]+)/.exec(cell.getAttribute('r') ?? '')?.[1]
      if (letters === undefined) continue
      const type = cell.getAttribute('t') ?? 'n'
      const value = elements(cell, 'v')[0]?.textContent ?? ''
      cells[columnIndex(letters)] = type === 's'
        ? (shared[Number(value)] ?? '')
        : type === 'inlineStr' ? elements(cell, 't').map((t) => t.textContent ?? '').join('') : value
    }
    rows[number - 1] = Array.from(cells, (cell) => cell ?? '')
  }
  return Array.from(rows, (row) => row ?? [])
}

/** Simple CSV (comma or tab, quotes allowed). */
function readCsv (text: string): string[][] {
  const sep = (text.split('\n')[0] ?? '').includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) { row.push(cell); cell = '' } else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '' } else cell += ch
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

export async function readCustomerSheet (file: File): Promise<string[][]> {
  const data = new Uint8Array(await file.arrayBuffer())
  if (/\.(csv|txt)$/i.test(file.name)) return readCsv(new TextDecoder().decode(data).replace(/^﻿/, ''))
  return readXlsx(data)
}
