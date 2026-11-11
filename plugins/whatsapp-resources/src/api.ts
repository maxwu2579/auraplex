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

async function request<T> (path: string, method = 'GET', body?: object): Promise<T> {
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
      cache: 'no-store'
    })
  } catch {
    throw new ConnectionError(whatsapp.string.Unavailable)
  }
  const result = await response.json()
  if (!response.ok) {
    const labels: Record<string, IntlString> = {
      Forbidden: whatsapp.string.Forbidden,
      Conflict: whatsapp.string.Conflict,
      InvalidParameters: whatsapp.string.InvalidParameters,
      NotConnected: whatsapp.string.ConnectionRequired,
      TemplatesFailed: whatsapp.string.TemplatesFailed
    }
    throw new ConnectionError(labels[result.code] ?? whatsapp.string.Failed)
  }
  return result as T
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
