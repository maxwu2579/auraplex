//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { createHmac, timingSafeEqual } from 'crypto'

export interface IncomingMessage {
  phoneNumberId: string
  wamid: string
  phone: string
  name: string
  content: string
  timestamp: number
}
export interface MessageStatusUpdate {
  phoneNumberId: string
  wamid: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  errorCode?: string
  errorMessage?: string
}
export interface WebhookBatch {
  messages: IncomingMessage[]
  statuses: MessageStatusUpdate[]
}

export function normalizePhone (phone: string): string {
  return phone.replace(/[^0-9]/g, '')
}

export function verifySignature (rawBody: Buffer, signature: string | undefined, appSecret: string): boolean {
  if (appSecret === '' || signature === undefined || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false
  const expected = createHmac('sha256', appSecret).update(rawBody).digest()
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))
}

export function verifyChallenge (mode: unknown, token: unknown, expected: string): boolean {
  return (
    mode === 'subscribe' &&
    typeof token === 'string' &&
    expected !== '' &&
    Buffer.byteLength(token) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  )
}

function record (value: unknown): Record<string, any> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid webhook')
  return value as Record<string, any>
}

export function parseWebhook (payload: unknown): WebhookBatch {
  const root = record(payload)
  if (root.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) throw new Error('Invalid webhook')
  const result: WebhookBatch = { messages: [], statuses: [] }
  for (const entry of root.entry) {
    if (!Array.isArray(record(entry).changes)) throw new Error('Invalid changes')
    for (const change of entry.changes) {
      if (record(change).field !== 'messages') continue
      const value = record(change.value)
      const phoneNumberId = value.metadata?.phone_number_id
      if (typeof phoneNumberId !== 'string' || !/^\d+$/.test(phoneNumberId)) throw new Error('Invalid number ID')
      if (value.messages !== undefined && !Array.isArray(value.messages)) throw new Error('Invalid messages')
      for (const raw of value.messages ?? []) {
        const message = record(raw)
        if (typeof message.id !== 'string' || message.id === '' || typeof message.from !== 'string') {
          throw new Error('Invalid message')
        }
        const phone = normalizePhone(message.from)
        const timestamp = Number(message.timestamp) * 1000
        if (phone === '' || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > 8640000000000000) {
          throw new Error('Invalid sender or time')
        }
        const profile = Array.isArray(value.contacts)
          ? value.contacts.find((c: any) => typeof c?.wa_id === 'string' && normalizePhone(c.wa_id) === phone)?.profile
          : undefined
        const name = typeof profile?.name === 'string' && profile.name.trim() !== '' ? profile.name.trim() : phone
        const type = typeof message.type === 'string' ? message.type : 'unknown'
        if (type === 'text' && typeof message.text?.body !== 'string') throw new Error('Invalid text')
        result.messages.push({
          phoneNumberId,
          wamid: message.id,
          phone,
          name,
          timestamp,
          content: type === 'text' ? message.text.body : '[不支持的消息类型: ' + type + ']'
        })
      }
      if (value.statuses !== undefined && !Array.isArray(value.statuses)) throw new Error('Invalid statuses')
      for (const raw of value.statuses ?? []) {
        const status = record(raw)
        if (typeof status.id !== 'string' || status.id === '') throw new Error('Invalid status ID')
        if (!['sent', 'delivered', 'read', 'failed'].includes(status.status)) continue
        result.statuses.push({
          phoneNumberId,
          wamid: status.id,
          status: status.status,
          errorCode: status.errors?.[0]?.code !== undefined ? String(status.errors[0].code) : undefined,
          errorMessage: status.status === 'failed' ? '消息发送失败，请检查账号配置或稍后重试。' : undefined
        })
      }
    }
  }
  return result
}
