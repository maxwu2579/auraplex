// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import type { BomLine } from '@hcengineering/materials'
import type { BomImportLine } from './bomWorkbook'

type Comparable = Pick<BomLine, 'code' | 'section' | 'quantityRaw' | 'quantityProblem' | 'quantity'> | BomImportLine
/** Pair repeated codes in the same section in row order, retaining their multiplicity. */
export function bomDiff (
  oldLines: Comparable[],
  newLines: Comparable[]
): { added: number, removed: number, quantityChanged: number } {
  const buckets = (lines: Comparable[]): Map<string, Comparable[]> => {
    const m = new Map<string, Comparable[]>()
    for (const line of lines) {
      const key = JSON.stringify([line.code, line.section])
      const list = m.get(key) ?? []
      list.push(line)
      m.set(key, list)
    }
    return m
  }
  const old = buckets(oldLines)
  const next = buckets(newLines)
  let added = 0
  let removed = 0
  let quantityChanged = 0
  for (const key of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(key) ?? []
    const b = next.get(key) ?? []
    added += Math.max(0, b.length - a.length)
    removed += Math.max(0, a.length - b.length)
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (
        a[i].quantityProblem !== b[i].quantityProblem ||
        (a[i].quantity !== undefined && b[i].quantity !== undefined
          ? a[i].quantity !== b[i].quantity
          : a[i].quantityRaw !== b[i].quantityRaw)
      ) { quantityChanged++ }
    }
  }
  return { added, removed, quantityChanged }
}
