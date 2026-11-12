// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import { strFromU8, unzipSync } from 'fflate'
import { normalizeCode } from '@hcengineering/materials'

export interface BomImportLine {
  code: string
  description: string
  quantityRaw: string
  quantity?: number
  quantityProblem: boolean
  codeProblem: boolean
  section: string
  sourceSheet: string
  sourceRow: number
}
export interface BomImportProduct {
  name: string
  normalizedName: string
  lines: BomImportLine[]
}
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
function xml (data: Uint8Array | undefined): Document {
  if (data === undefined) throw new Error('Excel 缺少必要文件')
  const result = new DOMParser().parseFromString(strFromU8(data), 'application/xml')
  if (result.getElementsByTagName('parsererror').length > 0) throw new Error('Excel 文件格式无效')
  return result
}
function elements (node: Document | Element, tag: string): Element[] {
  return Array.from(node.getElementsByTagNameNS('*', tag))
}
function path (target: string): string {
  const stack: string[] = []
  for (const p of (target.startsWith('/') ? target : `xl/${target}`).split('/')) {
    if (p === '..') {
      if (stack.length === 0) throw new Error('Excel 工作表路径无效')
      stack.pop()
    } else if (p !== '' && p !== '.') stack.push(p)
  }
  return stack.join('/')
}
/** Only workbook, shared strings and recognized worksheet XML are decompressed. Images are not read. */
export function readBomWorkbook (data: Uint8Array): BomImportProduct[] {
  const fixed = new Set(['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml'])
  const head = unzipSync(data, { filter: (entry) => fixed.has(entry.name) })
  const rels = new Map<string, string>()
  for (const item of elements(xml(head['xl/_rels/workbook.xml.rels']), 'Relationship')) {
    const id = item.getAttribute('Id')
    const target = item.getAttribute('Target')
    if (id !== null && target !== null && item.getAttribute('TargetMode') !== 'External') rels.set(id, path(target))
  }
  const shared =
    head['xl/sharedStrings.xml'] === undefined
      ? []
      : elements(xml(head['xl/sharedStrings.xml']), 'si').map((item) =>
        elements(item, 't')
          .map((t) => t.textContent ?? '')
          .join('')
      )
  const result: BomImportProduct[] = []
  const names = new Set<string>()
  for (const sheet of elements(xml(head['xl/workbook.xml']), 'sheet')) {
    const sheetName = sheet.getAttribute('name') ?? ''
    const name = sheetName.trim()
    const normalizedName = normalizeCode(name)
    if (normalizedName.includes('TEMPLATE') || name.includes('模板')) continue
    const id = sheet.getAttributeNS(REL, 'id')
    const target = id === null ? undefined : rels.get(id)
    if (target === undefined) throw new Error('BOM 工作表链接无效')
    const parts = unzipSync(data, { filter: (entry) => entry.name === target })
    const sheetDoc = xml(parts[target])
    let header = false
    let section = ''
    const lines: BomImportLine[] = []
    for (const row of elements(sheetDoc, 'row')) {
      const rowNumber = Number(row.getAttribute('r'))
      if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) continue
      if (!header && rowNumber > 100) break
      const cells: Record<string, { text: string, type: string, formula: boolean }> = {}
      for (const c of elements(row, 'c')) {
        const col = /^([A-Z]+)/.exec(c.getAttribute('r') ?? '')?.[1]
        if (col === undefined) continue
        const type = c.getAttribute('t') ?? 'n'
        const raw = elements(c, 'v')[0]?.textContent ?? ''
        const formula = elements(c, 'f')[0]
        const text =
          formula !== undefined
            ? `=${formula.textContent ?? ''}`
            : type === 's'
              ? (shared[Number(raw)] ?? '')
              : type === 'inlineStr'
                ? elements(c, 't')
                  .map((t) => t.textContent ?? '')
                  .join('')
                : raw
        cells[col] = { text, type, formula: formula !== undefined }
      }
      const get = (col: string): string => cells[col]?.text ?? ''
      if (normalizeCode(get('B')) === 'ASSY NAME:') {
        section = get('E')
        continue
      }
      const isHeader = [
        ['D', 'PART NO'],
        ['E', 'DESCRIPTION'],
        ['L', 'QTY']
      ].every(([col, label]) => normalizeCode(get(col)) === label)
      if (isHeader) {
        header = true
        continue
      }
      if (!header) continue
      const code = get('D')
      const desc = get('E')
      const qty = get('L')
      const numbered = get('B') !== '' && cells.B?.type === 'n' && !cells.B.formula && Number.isFinite(Number(get('B')))
      if (code === '' && !(numbered && (desc !== '' || qty !== ''))) continue
      const q = cells.L
      const number = q !== undefined && q.type === 'n' && !q.formula && qty.trim() !== '' ? Number(qty) : NaN
      const quantity = Number.isFinite(number) ? number : undefined
      const c = cells.D
      const codeProblem =
        c === undefined || c.formula || !['s', 'str', 'inlineStr'].includes(c.type) || normalizeCode(code) === ''
      lines.push({
        code: normalizeCode(code),
        description: desc,
        quantityRaw: qty,
        ...(quantity === undefined ? {} : { quantity }),
        quantityProblem: quantity === undefined || quantity <= 0,
        codeProblem,
        section,
        sourceSheet: sheetName,
        sourceRow: rowNumber
      })
    }
    if (!header || lines.length === 0) continue
    if (normalizedName === '' || names.has(normalizedName)) throw new Error('产品名称重复或为空，不能安全导入')
    names.add(normalizedName)
    result.push({ name, normalizedName, lines })
  }
  if (result.length === 0) throw new Error('未找到包含 BOM 明细的工作表')
  return result
}
