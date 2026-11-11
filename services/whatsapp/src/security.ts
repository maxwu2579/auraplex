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

import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt, randomUUID } from 'crypto'

export interface TokenEnvelope {
  keyId: string
  key: string
  iv: string
  ciphertext: string
  tag: string
}

// Each challenge is bound to the authenticated workspace and expires after five minutes.
// Only the public key leaves this service. Private keys are ephemeral and never logged.
export class TokenEncryption {
  private readonly keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })

  private readonly challenges = new Map<string, { owner: string, expires: number }>()

  createChallenge (owner: string): { keyId: string, publicKey: string } {
    for (const [id, entry] of this.challenges) {
      if (entry.expires <= Date.now()) this.challenges.delete(id)
    }
    if (this.challenges.size >= 1000) throw new Error('Too many pending connections')
    const keyId = randomUUID()
    this.challenges.set(keyId, { owner, expires: Date.now() + 5 * 60 * 1000 })
    return { keyId, publicKey: this.keys.publicKey }
  }

  decrypt (owner: string, envelope: TokenEnvelope): string {
    const challenge = this.challenges.get(envelope?.keyId)
    if (challenge === undefined || challenge.owner !== owner || challenge.expires <= Date.now()) {
      throw new Error('Invalid encryption challenge')
    }
    this.challenges.delete(envelope.keyId)
    const key = privateDecrypt(
      { key: this.keys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(envelope.key, 'base64')
    )
    const iv = Buffer.from(envelope.iv, 'base64')
    const tag = Buffer.from(envelope.tag, 'base64')
    if (key.length !== 32 || iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encryption envelope')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const token = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8')
    if (token.trim() === '' || token.length > 8192) throw new Error('Invalid access token')
    return token
  }
}
