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

import { constants, createCipheriv, publicEncrypt, randomBytes } from 'crypto'
import { TokenEncryption, type TokenEnvelope } from '../security'

function encrypt (keyId: string, publicKey: string, token: string): TokenEnvelope {
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const aes = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([aes.update(token), aes.final()])
  return {
    keyId,
    key: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString(
      'base64'
    ),
    iv: iv.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    tag: aes.getAuthTag().toString('base64')
  }
}

it('decrypts long tokens, binds them to a workspace, and prevents replay', () => {
  const encryption = new TokenEncryption()
  const challenge = encryption.createChallenge('workspace:owner')
  const token = randomBytes(512).toString('hex')
  const envelope = encrypt(challenge.keyId, challenge.publicKey, token)
  expect(JSON.stringify(envelope)).not.toContain(token)
  expect(() => encryption.decrypt('other:owner', envelope)).toThrow()
  expect(encryption.decrypt('workspace:owner', envelope)).toBe(token)
  expect(() => encryption.decrypt('workspace:owner', envelope)).toThrow()
})

it('rejects tampered ciphertext and expired challenges', () => {
  const encryption = new TokenEncryption()
  const challenge = encryption.createChallenge('owner')
  const envelope = encrypt(challenge.keyId, challenge.publicKey, 'local-test')
  envelope.tag = randomBytes(16).toString('base64')
  expect(() => encryption.decrypt('owner', envelope)).toThrow()
  const next = encryption.createChallenge('owner')
  const expired = encrypt(next.keyId, next.publicKey, 'local-test')
  const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60 * 1000)
  expect(() => encryption.decrypt('owner', expired)).toThrow()
  now.mockRestore()
})
