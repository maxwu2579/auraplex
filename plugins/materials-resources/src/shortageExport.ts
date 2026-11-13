// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import { strToU8, zipSync } from 'fflate'
import { calculateShortages, type CalculationProduct, type ShortageRow, type Material } from '@hcengineering/materials'

type Stock = Pick<Material, 'normalizedCode' | 'name' | 'stock' | 'rack' | 'level'>
type Cell = string | number | undefined
const names: Record<ShortageRow['status'], string> = { shortage: '缺料', problem: '有问题', enough: '够用' }
const headings = ['状态', '编号', '名称', '需要', '库存', '缺多少', '位置（货架 / 层）', '用于产品和装配段', '问题']
function rowsFor (rows: ShortageRow[]): Cell[][] {
  return [
    headings,
    ...rows.map((r) => [
      names[r.status],
      r.code,
      r.name,
      r.required,
      r.assumedZero ? '未知（按 0 估算）' : r.stock,
      r.shortage,
      [r.rack, r.level].filter(Boolean).join(' / '),
      r.uses
        .map(
          (u) => `${u.product} × ${u.count} / ${u.section !== '' ? u.section : '未指定装配段'}：${u.required ?? '未知'}`
        )
        .join('；'),
      r.issues.join('；')
    ])
  ]
}
function escapeXml (value: string): string {
  return Array.from(value)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 0xfffe && code !== 0xffff)
    })
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
function column (n: number): string {
  let out = ''
  for (n++; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out
  return out
}
function worksheet (rows: Cell[][]): string {
  const contents = rows
    .map(
      (row, i) =>
        `<row r="${i + 1}">${row
          .map((value, j) => {
            if (value === undefined) return ''
            const ref = `${column(j)}${i + 1}`
            return typeof value === 'number' && Number.isFinite(value)
              ? `<c r="${ref}"><v>${value}</v></c>`
              : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`
          })
          .join('')}</row>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${contents}</sheetData></worksheet>`
}
function uniqueSheetName (raw: string, used: Set<string>): string {
  const clean = Array.from(raw)
    .map((ch) => ('\\/?*[]:'.includes(ch) || (ch.codePointAt(0) ?? 0) < 32 ? '_' : ch))
    .join('')
    .replace(/^'+|'+$/g, '')
    .trim()
  const base = Array.from(clean !== '' ? clean : '产品')
    .slice(0, 31)
    .join('')
  let candidate = base
  let n = 2
  while (used.has(candidate.toLocaleLowerCase())) {
    const suffix = ` (${n++})`
    candidate =
      Array.from(base)
        .slice(0, 31 - suffix.length)
        .join('') + suffix
  }
  used.add(candidate.toLocaleLowerCase())
  return candidate
}
/** Creates a local xlsx using the repository's existing fflate dependency; text is never treated as a formula. */
export function createShortageWorkbook (products: CalculationProduct[], materials: Stock[]): Uint8Array {
  const combined = calculateShortages(products, materials)
  const sheets: Array<{ name: string, rows: Cell[][] }> = []
  const used = new Set<string>()
  const add = (name: string, rows: Cell[][]): void => {
    sheets.push({ name: uniqueSheetName(name, used), rows })
  }
  if (products.length === 1) {
    add('缺料表', rowsFor(combined.filter((r) => r.status === 'shortage')))
    add('问题表', rowsFor(combined.filter((r) => r.status === 'problem')))
  } else {
    const summary: Cell[][] = [['产品', '台数', '缺料项', '问题项', '够用项']]
    for (const product of products) {
      const rows = calculateShortages([product], materials)
      summary.push([
        product.name,
        product.count,
        rows.filter((r) => r.status === 'shortage').length,
        rows.filter((r) => r.status === 'problem').length,
        rows.filter((r) => r.status === 'enough').length
      ])
    }
    add('汇总', summary)
    add('合并', rowsFor(combined))
    for (const product of products) add(product.name, rowsFor(calculateShortages([product], materials)))
  }
  const files: Record<string, Uint8Array> = {}
  const put = (path: string, text: string): void => {
    files[path] = strToU8(text)
  }
  put(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`
  )
  put(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  )
  put(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`
  )
  put(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`
  )
  sheets.forEach((s, i) => {
    put(`xl/worksheets/sheet${i + 1}.xml`, worksheet(s.rows))
  })
  return zipSync(files, { level: 6 })
}
export function shortageFilename (products: CalculationProduct[], date: Date): string {
  const title = products.length === 1 ? products[0].name : products.map((p) => p.name).join('_')
  const cleaned = Array.from(title)
    .map((ch) => ('\\/:*?"<>|'.includes(ch) || (ch.codePointAt(0) ?? 0) < 32 ? '_' : ch))
    .join('')
    .replace(/[. ]+$/g, '')
    .trim()
  const safe = Array.from(cleaned !== '' ? cleaned : '产品')
    .slice(0, 100)
    .join('')
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `缺料计算_${safe}_${day}.xlsx`
}
