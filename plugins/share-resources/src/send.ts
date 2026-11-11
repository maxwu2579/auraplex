//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { copyTextToClipboard } from '@hcengineering/presentation'

// Personal WeChat / WhatsApp have no web API for posting into a chat, so we
// hand the content over the way a person would: clipboard, the WhatsApp
// "click to chat" link, or the operating system share sheet.

/** WhatsApp links get unreliable past a few thousand characters. */
const WHATSAPP_MAX = 3000

export async function copyText (text: string): Promise<void> {
  await copyTextToClipboard(text)
}

/** Writing images to the clipboard needs HTTPS (or localhost) and ClipboardItem. */
export function canCopyImage (): boolean {
  return window.isSecureContext && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write !== undefined
}

export async function copyImage (png: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

/**
 * Opens WhatsApp (app on phones / desktop, WhatsApp Web otherwise) with the text
 * pre-filled; the person picks the chat.
 */
export function openWhatsApp (text: string): void {
  const body = text.length > WHATSAPP_MAX ? text.slice(0, WHATSAPP_MAX - 1) + '…' : text
  window.open(`https://wa.me/?text=${encodeURIComponent(body)}`, '_blank', 'noopener')
}

/** System share sheet (phones, Windows, macOS Safari). Needs HTTPS. */
export function canSystemShare (): boolean {
  return window.isSecureContext && typeof navigator.share === 'function'
}

export async function systemShare (title: string, text: string, png?: Blob, filename = 'share.png'): Promise<void> {
  if (png !== undefined) {
    const file = new File([png], filename, { type: 'image/png' })
    const withFile: ShareData = { title, files: [file] }
    if (navigator.canShare?.(withFile)) {
      await navigator.share(withFile)
      return
    }
  }
  await navigator.share({ title, text })
}

/** The person closing the share sheet is not an error. */
export function isAbort (err: any): boolean {
  return err?.name === 'AbortError'
}
