// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0

import { strFromU8, unzipSync } from 'fflate'

export interface StockPicture {
  row: number
  cell: string
  kind: 'IN_CELL' | 'FLOATING'
  media?: string
  problem?: string
}
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const MAX_XML = 50_000_000
const imageExtension = /\.(png|jpe?g|gif|bmp)$/i

function xml (bytes: Uint8Array | undefined): Document {
  if (bytes === undefined) throw new Error('Excel 图片索引缺少必要文件')
  const result = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  if (result.getElementsByTagName('parsererror').length > 0) throw new Error('Excel 图片索引格式无效')
  return result
}
function descendants (node: Document | Element, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS('*', name))
}
function children (node: Element | undefined, name: string): Element[] {
  if (node === undefined) return []
  return Array.from(node.childNodes).filter(
    (child): child is Element => child.nodeType === 1 && (child as Element).localName === name
  )
}
function resolve (source: string, target: string): string {
  const parts: string[] = []
  const prefix = target.startsWith('/') ? target : `${source.slice(0, source.lastIndexOf('/') + 1)}${target}`
  for (const item of prefix.split('/')) {
    if (item === '..') {
      if (parts.length === 0) throw new Error('Excel 图片链接无效')
      parts.pop()
    } else if (item !== '' && item !== '.') parts.push(item)
  }
  return parts.join('/')
}
function relPath (source: string): string {
  const at = source.lastIndexOf('/')
  return `${source.slice(0, at)}/_rels/${source.slice(at + 1)}.rels`
}
function relationships (
  bytes: Uint8Array | undefined,
  source: string
): Array<{ id: string, kind: string, target: string }> {
  if (bytes === undefined) return []
  return descendants(xml(bytes), 'Relationship').flatMap((r) => {
    const id = r.getAttribute('Id')
    const kind = r.getAttribute('Type')
    const target = r.getAttribute('Target')
    if (id === null || kind === null || target === null || r.getAttribute('TargetMode') === 'External') return []
    return [{ id, kind: kind.split('/').pop() ?? '', target: resolve(source, target) }]
  })
}
function number (value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || !/^\d+$/.test(value)) return undefined
  const result = Number(value)
  return Number.isSafeInteger(result) ? result : undefined
}
function unpack (data: Uint8Array, names: Set<string>, found?: Set<string>): Record<string, Uint8Array> {
  return unzipSync(data, {
    filter: (entry) => {
      found?.add(entry.name)
      if (!names.has(entry.name)) return false
      if (entry.originalSize > MAX_XML) throw new Error('Excel 图片索引文件过大')
      return true
    }
  })
}

/** Indexes picture links without decompressing any media. Broken links are reported, never guessed. */
export function indexStockPictures (data: Uint8Array): StockPicture[] {
  const allNames = new Set<string>()
  const first = unpack(data, new Set(['xl/workbook.xml', 'xl/_rels/workbook.xml.rels']), allNames)
  const workbookLinks = relationships(first['xl/_rels/workbook.xml.rels'], 'xl/workbook.xml')
  const sheet = descendants(xml(first['xl/workbook.xml']), 'sheet').find(
    (item) => item.getAttribute('name') === 'AURA STOCK MAP-V2-K'
  )
  const sheetId = sheet?.getAttributeNS(REL, 'id')
  const sheetPart = workbookLinks.find((item) => item.id === sheetId)?.target
  if (sheetPart === undefined) throw new Error('库存工作表链接无效')
  const linkByKind = (kind: string): string | undefined => workbookLinks.find((item) => item.kind === kind)?.target
  const meta = linkByKind('sheetMetadata')
  const values = linkByKind('rdRichValue')
  const structures = linkByKind('rdRichValueStructure')
  const richRel = linkByKind('richValueRel')
  const wanted = new Set([
    sheetPart,
    relPath(sheetPart),
    ...[meta, values, structures, richRel].filter((v): v is string => v !== undefined)
  ])
  if (richRel !== undefined) wanted.add(relPath(richRel))
  const second = unpack(data, wanted)
  const sheetDoc = xml(second[sheetPart])
  const drawingParts = relationships(second[relPath(sheetPart)], sheetPart)
    .filter((item) => item.kind === 'drawing')
    .map((item) => item.target)
  const drawingWanted = new Set(drawingParts.flatMap((part) => [part, relPath(part)]))
  const drawings = unpack(data, drawingWanted)
  const result: StockPicture[] = []
  const rich = new Map<number, { media?: string, problem?: string }>()
  let blocks = 0
  if (meta !== undefined && second[meta] !== undefined) {
    const doc = xml(second[meta])
    const types = descendants(doc, 'metadataType').map((item) => item.getAttribute('name'))
    const future = descendants(doc, 'futureMetadata').find((item) => item.getAttribute('name') === 'XLRICHVALUE')
    const futureValues = children(future, 'bk').map((item) => number(descendants(item, 'rvb')[0]?.getAttribute('i')))
    const valueMetadata = descendants(doc, 'valueMetadata')[0]
    const valueBlocks = children(valueMetadata, 'bk')
    blocks = valueBlocks.length
    const structureItems =
      structures !== undefined && second[structures] !== undefined ? descendants(xml(second[structures]), 's') : []
    const valueItems =
      values !== undefined && second[values] !== undefined ? descendants(xml(second[values]), 'rv') : []
    const relationItems =
      richRel !== undefined && second[richRel] !== undefined ? descendants(xml(second[richRel]), 'rel') : []
    const targets = richRel === undefined ? [] : relationships(second[relPath(richRel)], richRel)
    for (const [index, block] of valueBlocks.entries()) {
      const rc = children(block, 'rc')[0]
      const ti = number(rc?.getAttribute('t'))
      const vi = number(rc?.getAttribute('v'))
      const fail = (problem: string): void => {
        rich.set(index + 1, { problem })
      }
      if (ti === undefined || ti < 1 || ti > types.length) {
        fail('METADATA_TYPE')
        continue
      }
      if (types[ti - 1] !== 'XLRICHVALUE') continue
      if (vi === undefined || vi >= futureValues.length) {
        fail('FUTURE_METADATA')
        continue
      }
      const ri = futureValues[vi]
      if (ri === undefined || ri >= valueItems.length) {
        fail('RICH_VALUE')
        continue
      }
      const value = valueItems[ri]
      const si = number(value.getAttribute('s'))
      if (si === undefined || si >= structureItems.length) {
        fail('RICH_STRUCTURE')
        continue
      }
      const structure = structureItems[si]
      if (structure.getAttribute('t') !== '_localImage') continue
      const keys = children(structure, 'k').map((key) => key.getAttribute('n'))
      const position = keys.indexOf('_rvRel:LocalImageIdentifier')
      if (position < 0) {
        fail('RICH_STRUCTURE')
        continue
      }
      const relationIndex = number(children(value, 'v')[position]?.textContent?.trim())
      const relationId =
        relationIndex === undefined ? undefined : relationItems[relationIndex]?.getAttributeNS(REL, 'id')
      const media = targets.find((item) => item.id === relationId)?.target
      if (media === undefined) {
        fail('RELATIONSHIP')
        continue
      }
      if (!imageExtension.test(media)) {
        fail('NOT_A_PICTURE')
        continue
      }
      if (!allNames.has(media)) {
        fail('TARGET_MISSING')
        continue
      }
      rich.set(index + 1, { media })
    }
  }
  for (const cell of descendants(sheetDoc, 'c')) {
    const vm = cell.getAttribute('vm')
    if (vm === null) continue
    const address = cell.getAttribute('r') ?? ''
    const match = /^([A-Z]{1,3})(\d+)$/.exec(address)
    if (match === null) continue
    const index = number(vm)
    const linked = index === undefined ? undefined : rich.get(index)
    if (linked !== undefined) result.push({ row: Number(match[2]), cell: address, kind: 'IN_CELL', ...linked })
    else if (index === undefined || index < 1 || index > blocks) {
      result.push({ row: Number(match[2]), cell: address, kind: 'IN_CELL', problem: 'VALUE_METADATA' })
    }
  }
  for (const part of drawingParts) {
    if (drawings[part] === undefined) throw new Error('Excel 浮动图片索引缺失')
    const targets = relationships(drawings[relPath(part)], part)
    for (const anchor of [
      ...descendants(xml(drawings[part]), 'twoCellAnchor'),
      ...descendants(xml(drawings[part]), 'oneCellAnchor')
    ]) {
      const start = children(anchor, 'from')[0]
      const row = number(children(start, 'row')[0]?.textContent)
      const col = number(children(start, 'col')[0]?.textContent)
      const blip = descendants(anchor, 'blip')[0]
      if (row === undefined || col === undefined || blip === undefined) continue
      const relationId = blip.getAttributeNS(REL, 'embed')
      const media = targets.find((item) => item.id === relationId)?.target
      let n = col + 1
      let letters = ''
      while (n > 0) {
        n--
        letters = String.fromCharCode(65 + (n % 26)) + letters
        n = Math.floor(n / 26)
      }
      const picture: StockPicture = { row: row + 1, cell: `${letters}${row + 1}`, kind: 'FLOATING' }
      if (media === undefined) picture.problem = 'RELATIONSHIP'
      else if (!imageExtension.test(media)) picture.problem = 'NOT_A_PICTURE'
      else if (!allNames.has(media)) picture.problem = 'TARGET_MISSING'
      else picture.media = media
      result.push(picture)
    }
  }
  return result
}
