//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { headingOf, type ShareContent } from './content'

// The card is drawn by hand on a canvas (not a DOM screenshot) so the output
// looks the same in light / dark theme and on every browser.

const WIDTH = 750 // CSS px; good width for phone chat previews
const PAD = 44
const SCALE = 2 // render at 2× for sharp text on phones
const MAX_BODY_LINES = 120 // long documents get cut with "…" (PDF / text keep everything)

const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC","Segoe UI",Roboto,Arial,sans-serif'
const C = {
  bg: '#FFFFFF',
  accent: '#2F6FED',
  tag: '#2F6FED',
  title: '#111827',
  label: '#6B7280',
  text: '#1F2937',
  link: '#2F6FED',
  rule: '#E5E7EB',
  footer: '#9CA3AF',
  chipBg: '#EEF3FE'
}

interface Op {
  draw: (ctx: CanvasRenderingContext2D) => void
}

const font = (size: number, weight = 400): string => `${weight} ${size}px ${FONT}`

/** Splits into tokens that may not be broken: a latin word, one CJK char, or whitespace. */
function tokens (s: string): string[] {
  return (
    s.match(
      /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]|[^\s\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]+|\s+/g
    ) ?? []
  )
}

/** Word-wraps `text` (which may contain \n) to `max` px. */
export function wrap (ctx: CanvasRenderingContext2D, text: string, max: number, breakAnywhere = false): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    if (para === '') {
      lines.push('')
      continue
    }
    let line = ''
    const parts = breakAnywhere ? Array.from(para) : tokens(para)
    for (const tok of parts) {
      const next = line + tok
      if (ctx.measureText(next).width <= max) {
        line = next
        continue
      }
      if (line.trim() !== '') lines.push(line.trimEnd())
      line = /^\s+$/.test(tok) ? '' : tok
      // a single token wider than the line (very long word / URL): hard-split it
      while (ctx.measureText(line).width > max && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > max) cut--
        lines.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

export function renderShareCard (content: ShareContent, selected: Set<string>): HTMLCanvasElement {
  const measure = document.createElement('canvas').getContext('2d')
  if (measure === null) throw new Error('2D canvas is not available')

  const inner = WIDTH - PAD * 2
  const ops: Op[] = []
  let y = 0

  const textBlock = (lines: string[], x: number, size: number, weight: number, color: string, lh: number): void => {
    const top = y
    ops.push({
      draw: (ctx) => {
        ctx.font = font(size, weight)
        ctx.fillStyle = color
        lines.forEach((l, i) => {
          ctx.fillText(l, x, top + i * lh + (lh - size) / 2)
        })
      }
    })
    y += lines.length * lh
  }
  const rule = (): void => {
    const at = y
    ops.push({
      draw: (ctx) => {
        ctx.fillStyle = C.rule
        ctx.fillRect(PAD, at, inner, 1)
      }
    })
  }

  // accent bar
  ops.push({
    draw: (ctx) => {
      ctx.fillStyle = C.accent
      ctx.fillRect(0, 0, WIDTH, 8)
    }
  })
  y = 8 + PAD

  const { tag, title } = headingOf(content, selected)

  // tag chip: "任务 · TSK-12"
  measure.font = font(22, 600)
  const chipW = Math.min(inner, measure.measureText(tag).width + 28)
  const chipTop = y
  ops.push({
    draw: (ctx) => {
      ctx.fillStyle = C.chipBg
      const r = 8
      ctx.beginPath()
      ctx.roundRect?.(PAD, chipTop, chipW, 40, r)
      if (ctx.roundRect === undefined) ctx.rect(PAD, chipTop, chipW, 40)
      ctx.fill()
      ctx.font = font(22, 600)
      ctx.fillStyle = C.tag
      ctx.fillText(tag, PAD + 14, chipTop + (40 - 22) / 2)
    }
  })
  y += 40 + 22

  if (title !== '') {
    measure.font = font(34, 700)
    textBlock(wrap(measure, title, inner), PAD, 34, 700, C.title, 48)
    y += 12
  }

  const on = content.fields.filter((f) => selected.has(f.id))

  // label / value rows
  const meta = on.filter((f) => f.role === 'meta')
  if (meta.length > 0) {
    y += 8
    rule()
    y += 26
    measure.font = font(24)
    const labelW = Math.min(200, Math.max(...meta.map((f) => measure.measureText(f.label).width)) + 28)
    for (const f of meta) {
      const top = y
      measure.font = font(26)
      const vlines = wrap(measure, f.value, inner - labelW)
      ops.push({
        draw: (ctx) => {
          ctx.font = font(24)
          ctx.fillStyle = C.label
          ctx.fillText(f.label, PAD, top + (38 - 24) / 2 + 1)
        }
      })
      textBlock(vlines, PAD + labelW, 26, 400, C.text, 38)
      y = Math.max(y, top + 38) + 10
    }
  }

  for (const f of on.filter((f) => f.role === 'body')) {
    y += 8
    rule()
    y += 26
    textBlock([f.label], PAD, 24, 600, C.label, 36)
    y += 6
    measure.font = font(26)
    let lines = wrap(measure, f.value, inner)
    if (lines.length > MAX_BODY_LINES) lines = [...lines.slice(0, MAX_BODY_LINES), '…']
    textBlock(lines, PAD, 26, 400, C.text, 42)
  }

  for (const f of on.filter((f) => f.role === 'link')) {
    y += 8
    rule()
    y += 26
    textBlock([f.label], PAD, 24, 600, C.label, 36)
    measure.font = font(22)
    textBlock(wrap(measure, f.value, inner, true), PAD, 22, 400, C.link, 32)
  }

  y += 20
  rule()
  y += 26
  measure.font = font(22)
  textBlock(wrap(measure, content.footer, inner), PAD, 22, 400, C.footer, 32)
  y += PAD - 10

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH * SCALE
  canvas.height = Math.ceil(y * SCALE)
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('2D canvas is not available')
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, WIDTH, y)
  ctx.textBaseline = 'top'
  for (const op of ops) op.draw(ctx)
  return canvas
}

export async function canvasToBlob (canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b === null) reject(new Error('Could not encode image'))
      else resolve(b)
    }, 'image/png')
  })
}

/**
 * PDF made from the rendered card, cut into A4-shaped pages. Text is an image
 * (keeps Chinese fonts right without embedding a font in the PDF).
 */
export async function canvasToPdf (canvas: HTMLCanvasElement): Promise<Blob> {
  const { jsPDF: JsPdf } = await import('jspdf')
  const pxToPt = 0.75 / SCALE
  const pageWpx = canvas.width
  const pageHpx = Math.floor(pageWpx * 1.414)
  const pageW = pageWpx * pxToPt
  const pageH = pageHpx * pxToPt
  const pdf = new JsPdf({ orientation: 'portrait', unit: 'pt', format: [pageW, pageH], compress: true })
  const tile = document.createElement('canvas')
  const tctx = tile.getContext('2d')
  if (tctx === null) throw new Error('2D canvas is not available')
  tile.width = pageWpx
  for (let top = 0, page = 0; top < canvas.height; top += pageHpx, page++) {
    const h = Math.min(pageHpx, canvas.height - top)
    tile.height = h
    tctx.fillStyle = '#FFFFFF'
    tctx.fillRect(0, 0, pageWpx, h)
    tctx.drawImage(canvas, 0, top, pageWpx, h, 0, 0, pageWpx, h)
    if (page > 0) pdf.addPage([pageW, pageH], 'portrait')
    pdf.addImage(tile.toDataURL('image/png'), 'PNG', 0, 0, pageW, h * pxToPt, undefined, 'FAST')
  }
  return pdf.output('blob')
}

export function downloadBlob (blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 10_000)
}
