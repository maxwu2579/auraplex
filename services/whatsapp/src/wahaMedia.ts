// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Config } from './config'

const maxBytes = 20 * 1024 * 1024

/** Media stays on the service volume and is served only after owner authentication. */
export class WahaMedia {
  constructor (private readonly config: Config, private readonly request: typeof fetch = fetch) {}

  private file (session: string, id: string): string {
    const key = createHash('sha256').update(JSON.stringify([session, id])).digest('hex')
    return join(this.config.inboxDirectory ?? '/var/lib/whatsapp/inbox', 'media', key)
  }

  async save (session: string, id: string, media: unknown): Promise<boolean> {
    if (!this.config.wahaUrl || !this.config.wahaApiKey || media == null || typeof media !== 'object') return false
    const url = (media as { url?: unknown }).url
    if (typeof url !== 'string') return false
    const file = this.file(session, id)
    const temporary = file + '.' + randomUUID()
    try {
      if (await stat(file).then(() => true).catch(() => false)) return true
      const base = new URL(this.config.wahaUrl)
      const target = new URL(url, base)
      if (target.origin !== base.origin || !target.pathname.startsWith('/api/files/') || target.username || target.password) return false
      const response = await this.request(target, {
        redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'X-Api-Key': this.config.wahaApiKey }
      })
      if (!response.ok || response.body === null) return false
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > maxBytes) return false
          chunks.push(chunk.value)
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      if (size === 0) return false
      await mkdir(join(this.config.inboxDirectory ?? '/var/lib/whatsapp/inbox', 'media'), { recursive: true, mode: 0o700 })
      await writeFile(temporary, Buffer.concat(chunks), { mode: 0o600 })
      await rename(temporary, file)
      return true
    } catch {
      return false
    } finally {
      await unlink(temporary).catch(() => {})
    }
  }

  async read (session: string, id: string): Promise<Buffer | undefined> {
    return await readFile(this.file(session, id)).catch(() => undefined)
  }
}
