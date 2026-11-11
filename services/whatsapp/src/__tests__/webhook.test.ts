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

import { createHmac, randomBytes } from 'crypto'
import { normalizePhone, parseWebhook, verifySignature, verifyChallenge } from '../webhook'

function sample (
  messages: object[] = [
    {
      id: 'wamid.test',
      from: '6588880001',
      timestamp: '1700000000',
      type: 'text',
      text: { body: '<script>hello</script>' }
    }
  ]
): any {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: '100001' },
              contacts: [{ wa_id: '6588880001', profile: { name: '客户甲' } }],
              messages
            }
          }
        ]
      }
    ]
  }
}

it.each([
  ['+65 (8888) 0001', '6588880001'],
  ['65-8888-0001', '6588880001'],
  ['6588880001', '6588880001'],
  [' ( ) + - ', '']
])('normalizes phone %s', (value, expected) => {
  expect(normalizePhone(value)).toBe(expected)
})

it('verifies raw bytes and rejects changes, missing or malformed signatures', () => {
  const secret = randomBytes(32).toString('hex')
  const raw = Buffer.from('{ "text": "中文" }')
  const signature = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')
  expect(verifySignature(raw, signature, secret)).toBe(true)
  expect(verifySignature(Buffer.from(JSON.stringify(JSON.parse(raw.toString()))), signature, secret)).toBe(false)
  expect(verifySignature(raw, undefined, secret)).toBe(false)
  expect(verifySignature(raw, 'sha256=abcd', secret)).toBe(false)
  expect(verifySignature(raw, signature, '')).toBe(false)
})

it('requires subscribe mode, matching verify token and configured secret', () => {
  expect(verifyChallenge('subscribe', 'test', 'test')).toBe(true)
  expect(verifyChallenge('other', 'test', 'test')).toBe(false)
  expect(verifyChallenge('subscribe', 'wrong', 'test')).toBe(false)
  expect(verifyChallenge('subscribe', '', '')).toBe(false)
})

it('parses names and text safely, preserves unsupported types, and parses multi-entry status events', () => {
  const value = sample()
  value.entry.push({
    changes: [
      {
        field: 'messages',
        value: {
          metadata: { phone_number_id: '100002' },
          messages: [{ id: 'image', from: '6012345678', timestamp: '1700000001', type: 'image' }],
          statuses: [{ id: 'out', status: 'read' }]
        }
      }
    ]
  })
  const result = parseWebhook(value)
  expect(result.messages[0]).toMatchObject({
    phone: '6588880001',
    name: '客户甲',
    content: '<script>hello</script>',
    timestamp: 1700000000000
  })
  expect(result.messages[1]).toMatchObject({
    phoneNumberId: '100002',
    name: '6012345678',
    content: '[不支持的消息类型: image]'
  })
  expect(result.statuses[0]).toMatchObject({ wamid: 'out', status: 'read', phoneNumberId: '100002' })
})

it('rejects malformed messages and impossible timestamps', () => {
  expect(() => parseWebhook({})).toThrow()
  expect(() =>
    parseWebhook(sample([{ id: 'bad', from: '', type: 'text', timestamp: '1', text: { body: 'x' } }]))
  ).toThrow()
  expect(() =>
    parseWebhook(sample([{ id: 'bad', from: '123', type: 'text', timestamp: '1e99', text: { body: 'x' } }]))
  ).toThrow()
  expect(() => parseWebhook(sample([{ id: 'bad', from: '123', type: 'text', timestamp: '1' }]))).toThrow()
})
