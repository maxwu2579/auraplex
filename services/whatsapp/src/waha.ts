// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import type { Config } from './config'
import { SendError } from './graph'
import type { WebhookBatch } from './webhook'
import type { WhatsAppProvider } from './provider'

export interface WahaSession {
  status: string
  me?: { id?: string }
}

export function sessionName (workspace: string, owner: string): string {
  return 'huly-' + createHash('sha256').update(JSON.stringify([workspace, owner])).digest('hex').slice(0, 32)
}

export function verifyWahaSignature (raw: Buffer, signature: string, secret: string): boolean {
  if (secret === '' || !/^[a-f0-9]{128}$/i.test(signature)) return false
  const expected = createHmac('sha512', secret).update(raw).digest()
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
}

export class WahaClient implements WhatsAppProvider<string, string, WahaSession | undefined, void> {
  constructor (private readonly config: Config, private readonly request: typeof fetch = fetch) {}

  private async call (path: string, method = 'GET', body?: unknown): Promise<Response> {
    if (!this.config.wahaUrl || !this.config.wahaApiKey) throw new SendError('UNCONFIGURED', 'WhatsApp 未配置，请联系管理员。')
    return await this.request(new URL(path, this.config.wahaUrl), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { 'X-Api-Key': this.config.wahaApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }

  async status (session: string): Promise<WahaSession | undefined> {
    const res = await this.call('/api/sessions/' + session)
    if (res.status === 404) return undefined
    if (!res.ok) throw new Error('WAHA unavailable')
    return await res.json() as WahaSession
  }

  async me (session: string): Promise<{ id?: string } | undefined> {
    const res = await this.call('/api/sessions/' + session + '/me')
    return res.ok ? (await res.json() as { id?: string } | null) ?? undefined : undefined
  }

  async resolveLid (session: string, lid: string): Promise<string | undefined> {
    if (!/^\d+@lid$/.test(lid)) return undefined
    try {
      const res = await this.call('/api/' + session + '/lids/' + encodeURIComponent(lid))
      if (!res.ok) return undefined
      const { pn } = await res.json() as { pn?: string }
      return typeof pn === 'string' && /^\d+@c\.us$/.test(pn) ? pn : undefined
    } catch {
      return undefined
    }
  }

  async bind (session: string): Promise<void> {
    const existing = await this.status(session)
    if (existing === undefined) {
      const res = await this.call('/api/sessions', 'POST', {
        name: session,
        start: true,
        config: { webjs: { tagsEventsOn: true }, webhooks: [{
          url: this.config.wahaWebhookUrl ?? this.config.publicUrl + '/webhook/waha',
          events: ['message.any', 'message.ack', 'session.status'],
          retries: { policy: 'linear', delaySeconds: 2, attempts: 12 },
          hmac: { key: this.config.wahaWebhookSecret }
        }] }
      })
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 4000)
        if (/only.{0,60}(default|one session)|core.{0,60}(default|session)|default.{0,60}session/i.test(detail)) {
          throw new Error('SingleSession')
        }
        throw new Error('WAHA unavailable')
      }
    } else if (['FAILED', 'STOPPED'].includes(existing.status)) {
      const res = await this.call('/api/sessions/' + session + '/' + (existing.status === 'FAILED' ? 'restart' : 'start'), 'POST')
      if (!res.ok) throw new Error('WAHA unavailable')
    }
  }

  async qr (session: string): Promise<string | undefined> {
    const res = await this.call('/api/' + session + '/auth/qr')
    if (!res.ok) return undefined
    const mime = res.headers.get('content-type')?.split(';')[0]
    if (mime === 'image/png') return Buffer.from(await res.arrayBuffer()).toString('base64')
    if (mime !== 'application/json') return undefined
    const { data, mimetype } = await res.json() as { data?: string, mimetype?: string }
    return mimetype === 'image/png' && typeof data === 'string' ? data : undefined
  }

  async disconnect (session: string): Promise<void> {
    const logout = await this.call('/api/sessions/' + session + '/logout', 'POST')
    if (!logout.ok && logout.status !== 404) throw new Error('WAHA unavailable')
    const remove = await this.call('/api/sessions/' + session, 'DELETE')
    if (!remove.ok && remove.status !== 404) throw new Error('WAHA unavailable')
  }

  async send (session: string, phone: string, text: string): Promise<string> {
    const res = await this.call('/api/sendText', 'POST', { session, chatId: phone + '@c.us', text })
    if (!res.ok) throw new SendError('WAHA_SEND', '发送失败，请检查号码或重新扫码连接。')
    const { id } = await res.json() as { id?: string }
    if (typeof id !== 'string' || id === '') throw new SendError('WAHA_SEND', '发送状态未确认，请检查手机。')
    return id
  }
}

export function parseWahaEvent (
  event: string, session: string, ownPhone: string, payload: Record<string, unknown>
): WebhookBatch {
  const result: WebhookBatch = { messages: [], statuses: [] }
  if (typeof payload.id !== 'string' || payload.id === '') return result
  const outgoing = payload.fromMe === true
  const peer = payload.chatId ?? (outgoing && payload.to != null ? payload.to : payload.from)
  const phone = typeof peer === 'string' ? peer.match(/^(\d+)@c\.us$/)?.[1] ?? (/^\d+@lid$/.test(peer) ? peer : undefined) : undefined
  if (phone === undefined || phone === ownPhone) return result
  if (event === 'message.ack') {
    const names: Record<string, 'sent' | 'delivered' | 'read' | 'failed'> = {
      SERVER: 'sent', DEVICE: 'delivered', READ: 'read', PLAYED: 'read', ERROR: 'failed'
    }
    const status = names[String(payload.ackName)] ?? ({ 1: 'sent', 2: 'delivered', 3: 'read', 4: 'read' } as const)[Number(payload.ack) as 1 | 2 | 3 | 4]
    if (outgoing && status !== undefined) result.statuses.push({ session, phoneNumberId: ownPhone, wamid: payload.id, status })
    return result
  }
  if (event !== 'message' && event !== 'message.any') return result
  const media = payload.media as Record<string, unknown> | undefined
  const placeholder = typeof media?.mimetype === 'string' && media.mimetype.startsWith('image/') ? '[图片]' : '[文件]'
  const body = typeof payload.body === 'string' ? payload.body : ''
  const content = payload.hasMedia === true ? [body, placeholder].filter(Boolean).join(' ') : body
  const timestamp = Number(payload.timestamp) * 1000
  if (content === '' || !Number.isFinite(timestamp) || timestamp <= 0) return result
  result.messages.push({ session, outgoing, phoneNumberId: ownPhone, wamid: payload.id, phone, name: phone.endsWith('@lid') ? 'WhatsApp · ' + phone.slice(-8, -4) : phone, content, timestamp })
  return result
}
