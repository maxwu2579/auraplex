// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { WahaKeyRejected } from './waha'
import type { Config } from './config'

export class WahaMediaTooLarge extends Error {}

/** Media stays on the service volume and is served only after owner authentication. */
export class WahaMedia {
  constructor (private readonly config: Config, private readonly request: typeof fetch = fetch) {}

  private file (session: string, id: string): string {
    const key = createHash('sha256').update(JSON.stringify([session, id])).digest('hex')
    return join(this.config.inboxDirectory ?? '/var/lib/whatsapp/inbox', 'media', key)
  }

  async write (session: string, id: string, bytes: Buffer, media: { mimetype?: unknown, filename?: unknown }): Promise<void> {
    const file = this.file(session, id)
    const temporary = file + '.' + randomUUID()
    const value = {
      mime: typeof media.mimetype === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(media.mimetype)
        ? media.mimetype : 'application/octet-stream',
      name: typeof media.filename === 'string' ? media.filename.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 160) : 'attachment'
    }
    await mkdir(join(this.config.inboxDirectory ?? '/var/lib/whatsapp/inbox', 'media'), { recursive: true, mode: 0o700 })
    try {
      await writeFile(temporary, bytes, { mode: 0o600 })
      await rename(temporary, file)
      await writeFile(file + '.json', JSON.stringify(value), { mode: 0o600 })
    } finally {
      await unlink(temporary).catch(() => {})
    }
  }

  async details (session: string, id: string): Promise<{ mime: string, name: string }> {
    try {
      return JSON.parse(await readFile(this.file(session, id) + '.json', 'utf8'))
    } catch {
      return { mime: 'application/octet-stream', name: 'whatsapp-attachment.bin' }
    }
  }

  async save (session: string, id: string, media: unknown): Promise<boolean> {
    if (!this.config.wahaUrl || !this.config.wahaApiKey || media == null || typeof media !== 'object') return false
    const url = (media as { url?: unknown }).url
    if (typeof url !== 'string') return false
    const maxBytes = (this.config.mediaLimitMb ?? 20) * 1024 * 1024
    const file = this.file(session, id)
    try {
      if (await stat(file).then(() => true).catch(() => false)) return true
      const base = new URL(this.config.wahaUrl)
      const target = new URL(url, base)
      if (target.origin !== base.origin || !target.pathname.startsWith('/api/files/') || target.username || target.password) return false
      const response = await this.request(target, {
        redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'X-Api-Key': this.config.wahaApiKey }
      })
      if ([401, 403].includes(response.status)) throw new WahaKeyRejected()
      if (!response.ok || response.body === null) return false
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > maxBytes) throw new WahaMediaTooLarge()
          chunks.push(chunk.value)
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      if (size === 0) return false
      await this.write(session, id, Buffer.concat(chunks), media as { mimetype?: unknown, filename?: unknown })
      return true
    } catch (err) {
      if (err instanceof WahaKeyRejected || err instanceof WahaMediaTooLarge) throw err
      return false
    }
  }

  async read (session: string, id: string): Promise<Buffer | undefined> {
    return await readFile(this.file(session, id)).catch(() => undefined)
  }
}
