// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import { strToU8, zipSync } from 'fflate'

export type Cell = string | number | undefined
/** Row colours. The first row of every sheet is the heading and is always bold. */
export type RowStyle = 'red' | 'yellow' | undefined
export interface Sheet {
  name: string
  rows: Cell[][]
  styles?: RowStyle[]
}

// cellXfs index: 0 normal, 1 bold heading, 2 red fill, 3 yellow fill
const styleIndex: Record<Exclude<RowStyle, undefined>, number> = { red: 2, yellow: 3 }
const STYLES =
  '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFE1E1"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2C3"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'

export function escapeXml (value: string): string {
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
function worksheet (sheet: Sheet): string {
  const contents = sheet.rows
    .map((row, i) => {
      const style = i === 0 ? 1 : ((styleIndex as Record<string, number>)[sheet.styles?.[i] ?? ''] ?? 0)
      const s = style === 0 ? '' : ` s="${style}"`
      return `<row r="${i + 1}">${row
        .map((value, j) => {
          const ref = `${column(j)}${i + 1}`
          if (value === undefined) return style === 0 ? '' : `<c r="${ref}"${s}/>`
          return typeof value === 'number' && Number.isFinite(value)
            ? `<c r="${ref}"${s}><v>${value}</v></c>`
            : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`
        })
        .join('')}</row>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${contents}</sheetData></worksheet>`
}
export function uniqueSheetName (raw: string, used: Set<string>): string {
  const clean = Array.from(raw)
    .map((ch) => ('\\/?*[]:'.includes(ch) || (ch.codePointAt(0) ?? 0) < 32 ? '_' : ch))
    .join('')
    .replace(/^'+|'+$/g, '')
    .trim()
  const base = Array.from(clean !== '' ? clean : '表')
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
export function createWorkbook (input: Sheet[]): Uint8Array {
  const used = new Set<string>()
  const sheets = input.map((s) => ({ ...s, name: uniqueSheetName(s.name, used) }))
  const files: Record<string, Uint8Array> = {}
  const put = (path: string, text: string): void => {
    files[path] = strToU8(text)
  }
  put(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`
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
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  )
  put('xl/styles.xml', STYLES)
  sheets.forEach((s, i) => {
    put(`xl/worksheets/sheet${i + 1}.xml`, worksheet(s))
  })
  return zipSync(files, { level: 6 })
}

/** Makes a file name safe for Windows and adds the date, e.g. 物料库存_2026-11-13.xlsx */
export function datedFilename (prefix: string, title: string, date: Date): string {
  const cleaned = Array.from(title)
    .map((ch) => ('\\/:*?"<>|'.includes(ch) || (ch.codePointAt(0) ?? 0) < 32 ? '_' : ch))
    .join('')
    .replace(/[. ]+$/g, '')
    .trim()
  const safe = Array.from(cleaned).slice(0, 100).join('')
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return safe === '' ? `${prefix}_${day}.xlsx` : `${prefix}_${safe}_${day}.xlsx`
}

/** Hands the workbook to the browser as a download. */
export function downloadWorkbook (data: Uint8Array, filename: string): void {
  const copy = new Uint8Array(data.length)
  copy.set(data)
  const url = URL.createObjectURL(
    new Blob([copy.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 60000)
}

/** Local date and time for spreadsheets, e.g. 2026-11-13 16:05 */
export function formatDateTime (value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  const d = new Date(value)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}
