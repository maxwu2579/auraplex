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

import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt, randomBytes, webcrypto } from 'crypto'
import { getMetadata } from '@hcengineering/platform'
import { saveConnection } from '../api'

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getMetadata: jest.fn()
}))
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: { metadata: { Token: 'session-token' } }
}))
jest.mock('@hcengineering/integration-client', () => ({ getIntegrationEventBus: () => ({ emit: jest.fn() }) }))

it('submits only encrypted credentials, including long Unicode tokens', async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const token = randomBytes(256).toString('hex') + '本地测试'
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { crypto: webcrypto } })
  ;(getMetadata as jest.Mock).mockImplementation((key) =>
    key === 'session-token' ? 'local-huly-session' : 'http://localhost:8098'
  )
  const postBodies: string[] = []
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') postBodies.push(String(init.body))
    return new Response(
      JSON.stringify(
        init?.method === 'POST'
          ? { connected: true }
          : { keyId: 'local-challenge', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }) }
      ),
      { status: 200 }
    )
  })
  try {
    await saveConnection('100001', '200001', token)
    expect(postBodies).toHaveLength(1)
    expect(postBodies[0]).not.toContain(token)
    expect(postBodies[0]).not.toContain('accessToken')
    const envelope = JSON.parse(postBodies[0]).encryptedToken
    const key = privateDecrypt(
      { key: keys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(envelope.key, 'base64')
    )
    const aes = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
    aes.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    expect(Buffer.concat([aes.update(Buffer.from(envelope.ciphertext, 'base64')), aes.final()]).toString('utf8')).toBe(
      token
    )
  } finally {
    fetchMock.mockRestore()
    if (originalWindow !== undefined) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
