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

import { getMetadata, type IntlString } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'
import { getIntegrationEventBus } from '@hcengineering/integration-client'
import { pki, md, cipher, util } from 'node-forge'
import whatsapp, { type WhatsappTemplate } from '@hcengineering/whatsapp'

export interface ConnectionState {
  provider?: 'waha' | 'meta'
  status?: string
  historyState?: string
  historyCount?: number
  mediaLimitMb?: number
  qr?: string
  displayPhone?: string
  connected: boolean
  phoneNumberId?: string
  wabaId?: string
  webhook: string
  mode: string
  /** Free-form reply window in ms (24 hours unless shortened for local testing). */
  replyWindowMs?: number
}

export class ConnectionError extends Error {
  constructor (readonly label: IntlString) {
    super('WhatsApp connection failed')
  }
}

// Auraplex: settings and supervision use the same authenticated service API.
export async function request<T> (path: string, method = 'GET', body?: object): Promise<T> {
  const base = getMetadata(whatsapp.metadata.WhatsappURL)
  if (base === undefined || base === '') throw new ConnectionError(whatsapp.string.Unavailable)
  let response: Response
  try {
    response = await fetch(base.replace(/\/$/, '') + '/api/' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + (getMetadata(presentation.metadata.Token) ?? ''),
        'Content-Type': 'application/json'
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000)
    })
  } catch {
    throw new ConnectionError(whatsapp.string.Unavailable)
  }
  if (response.status === 503) throw new ConnectionError(whatsapp.string.Unavailable)
  const result = await response.json().catch(() => { throw new ConnectionError(whatsapp.string.Unavailable) })
  if (!response.ok) {
    const labels: Record<string, IntlString> = {
      Forbidden: whatsapp.string.Forbidden,
      SingleSession: whatsapp.string.WahaSingleSession,
      Conflict: whatsapp.string.Conflict,
      InvalidParameters: whatsapp.string.InvalidParameters,
      NotConnected: whatsapp.string.ConnectionRequired,
      TemplatesFailed: whatsapp.string.TemplatesFailed
    }
    throw new ConnectionError(labels[result.code] ?? whatsapp.string.Failed)
  }
  return result as T
}

export interface ConnectionSummary {
  person: string
  phoneNumberId?: string
  displayPhone?: string
  connectedOn?: number
  provider?: 'waha' | 'meta'
  status?: string
}
export async function getConnections (): Promise<ConnectionSummary[]> {
  return await request<ConnectionSummary[]>('connections')
}

export async function getConnection (): Promise<ConnectionState> {
  return await request<ConnectionState>('connection')
}

export async function saveConnection (phoneNumberId: string, wabaId: string, token: string): Promise<void> {
  let encryptedToken
  if (token !== '') {
    const challenge = await request<{ keyId: string, publicKey: string }>('key')
    // Native randomness works on the local HTTP host too. Never fall back to a PRNG.
    const bytes = new Uint8Array(44)
    window.crypto.getRandomValues(bytes)
    const key = String.fromCharCode(...bytes.slice(0, 32))
    const iv = String.fromCharCode(...bytes.slice(32))
    const aes = cipher.createCipher('AES-GCM', key)
    aes.start({ iv, tagLength: 128 })
    aes.update(util.createBuffer(util.encodeUtf8(token)))
    aes.finish()
    const publicKey = pki.publicKeyFromPem(challenge.publicKey)
    encryptedToken = {
      keyId: challenge.keyId,
      key: util.encode64(
        publicKey.encrypt(key, 'RSA-OAEP', { md: md.sha256.create(), mgf1: { md: md.sha256.create() } })
      ),
      iv: util.encode64(iv),
      ciphertext: util.encode64(aes.output.getBytes()),
      tag: util.encode64(aes.mode.tag.getBytes())
    }
  }
  await request('connection', 'POST', { phoneNumberId, wabaId, encryptedToken })
  getIntegrationEventBus().emit('integration:created', {})
}

export async function disconnect (): Promise<void> {
  await request('connection', 'DELETE')
  getIntegrationEventBus().emit('integration:deleted', {})
}

export async function getTemplates (): Promise<WhatsappTemplate[]> {
  const result = await request<{ templates: WhatsappTemplate[] }>('templates')
  return result.templates
}

// Auraplex: all pairing operations act on the authenticated user's session.
export async function startWahaConnection (): Promise<ConnectionState> {
  const result = await request<ConnectionState>('connection', 'POST', {})
  getIntegrationEventBus().emit('integration:created', {})
  return result
}

export async function getWahaQr (): Promise<ConnectionState> {
  return await request<ConnectionState>('qr')
}

export async function downloadWahaAttachment (id: string): Promise<void> {
  const base = getMetadata(whatsapp.metadata.WhatsappURL)
  if (!base) throw new ConnectionError(whatsapp.string.Unavailable)
  const result = await fetch(base.replace(/\/$/, '') + '/api/media', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (getMetadata(presentation.metadata.Token) ?? ''), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  })
  if (!result.ok) throw new ConnectionError(whatsapp.string.Failed)
  const url = URL.createObjectURL(await result.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = 'whatsapp-attachment.bin'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function readWahaAttachment (id: string, scope?: { employee: string, channel: string }): Promise<{
  blob: Blob, mime: string, name: string
}> {
  const base = getMetadata(whatsapp.metadata.WhatsappURL)
  if (!base) throw new ConnectionError(whatsapp.string.Unavailable)
  const result = await fetch(base.replace(/\/$/, '') + '/api/media', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (getMetadata(presentation.metadata.Token) ?? ''), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...scope }), cache: 'no-store', signal: AbortSignal.timeout(15000)
  })
  if (!result.ok) throw new ConnectionError(whatsapp.string.Failed)
  const mime = result.headers.get('X-WA-Mime') ?? 'application/octet-stream'
  return {
    blob: (await result.blob()).slice(0, undefined, mime),
    mime,
    name: decodeURIComponent(result.headers.get('X-WA-Name') ?? 'attachment')
  }
}

export async function sendWahaAttachment (channel: string, file: File, caption: string): Promise<void> {
  const base = getMetadata(whatsapp.metadata.WhatsappURL)
  if (!base) throw new ConnectionError(whatsapp.string.Unavailable)
  const result = await fetch(base.replace(/\/$/, '') + '/api/send-media', {
    method: 'POST', body: file,
    headers: {
      Authorization: 'Bearer ' + (getMetadata(presentation.metadata.Token) ?? ''),
      'Content-Type': 'application/octet-stream', 'X-WA-Channel': channel,
      'X-WA-Name': encodeURIComponent(file.name), 'X-WA-Mime': file.type || 'application/octet-stream',
      'X-WA-Caption': encodeURIComponent(caption.slice(0, 1000))
    },
    signal: AbortSignal.timeout(45000)
  })
  if (!result.ok) throw new ConnectionError(whatsapp.string.Failed)
}
