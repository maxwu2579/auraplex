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

import type { Server } from 'http'
import { createHmac, randomBytes } from 'crypto'
import { AccountRole } from '@hcengineering/core'
import { getClient } from '@hcengineering/account-client'
import { createApp } from '../server'
import type { ConnectionStore } from '../integrations'
import type { Config } from '../config'

jest.mock('@hcengineering/account-client', () => ({
  ...jest.requireActual('@hcengineering/account-client'),
  getClient: jest.fn()
}))

let server: Server
let base: string
const getLogin = jest.fn()
const inbox = { enqueue: jest.fn().mockResolvedValue(undefined) }
const store = { get: jest.fn(), connect: jest.fn(), disconnect: jest.fn(), accessToken: jest.fn() }
const graphRequest = jest.fn()
const config: Config = {
  port: 0,
  accountsUrl: 'http://localhost:1',
  secret: 'unused',
  publicUrl: 'http://localhost',
  allowedOrigins: ['http://localhost'],
  graphUrl: 'http://localhost:2',
  graphVersion: 'mock',
  appSecret: randomBytes(32).toString('hex'),
  verifyToken: randomBytes(32).toString('hex')
}

beforeAll(async () => {
  server = createApp(
    config,
    store as unknown as ConnectionStore,
    inbox,
    graphRequest as unknown as typeof fetch
  ).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing server address')
  base = 'http://127.0.0.1:' + address.port
})
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => {
      err !== undefined ? reject(err) : resolve()
    })
  )
})
beforeEach(() => {
  jest.clearAllMocks()
  getLogin.mockResolvedValue({ workspace: 'ws', account: 'owner', role: AccountRole.Owner })
  ;(getClient as jest.Mock).mockReturnValue({
    getLoginInfoByToken: getLogin,
    getSocialIds: async () => [{ _id: 'social', verifiedOn: 1 }]
  })
})

it('provides health, rejects missing credentials and rejects ordinary members', async () => {
  expect((await fetch(base + '/health')).status).toBe(200)
  expect((await fetch(base + '/api/key')).status).toBe(401)
  getLogin.mockResolvedValue({ workspace: 'ws', account: 'owner', role: AccountRole.User })
  expect((await fetch(base + '/api/key', { headers: { Authorization: 'Bearer local-test' } })).status).toBe(403)
  expect(store.get).not.toHaveBeenCalled()
})

it('returns only public connection fields and never accepts a plaintext token', async () => {
  store.get.mockResolvedValue({ data: { phoneNumberId: '123', wabaId: '456', accessToken: 'do-not-return' } })
  const headers = { Authorization: 'Bearer local-test', 'Content-Type': 'application/json' }
  const response = await fetch(base + '/api/connection', { headers })
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.text()).not.toContain('do-not-return')
  store.connect.mockRejectedValue(new Error('TOKEN_REQUIRED'))
  const plain = await fetch(base + '/api/connection', {
    method: 'POST',
    headers,
    body: JSON.stringify({ phoneNumberId: '123', wabaId: '456', accessToken: 'do-not-accept' })
  })
  expect(plain.status).toBe(400)
  expect(store.connect.mock.calls[0][3]).toBeUndefined()
  expect(await plain.text()).not.toContain('do-not-accept')
})

function incoming (): object {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: '100001' },
              messages: [
                { id: 'wamid.http', from: '6588880001', timestamp: '1700000000', type: 'text', text: { body: '你好' } }
              ]
            }
          }
        ]
      }
    ]
  }
}

it('verifies webhook challenges and checks signatures on original request bytes', async () => {
  const params = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.verify_token': config.verifyToken ?? '',
    'hub.challenge': '123456'
  })
  const challenge = await fetch(base + '/webhook?' + params.toString())
  expect(challenge.status).toBe(200)
  expect(await challenge.text()).toBe('123456')
  params.set('hub.verify_token', 'wrong')
  expect((await fetch(base + '/webhook?' + params.toString())).status).toBe(403)
  const raw = JSON.stringify(incoming(), null, 2)
  const signature =
    'sha256=' +
    createHmac('sha256', config.appSecret ?? '')
      .update(raw)
      .digest('hex')
  const headers = { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }
  expect((await fetch(base + '/webhook', { method: 'POST', headers, body: raw })).status).toBe(200)
  expect(inbox.enqueue).toHaveBeenCalledTimes(1)
  expect((await fetch(base + '/webhook', { method: 'POST', headers, body: JSON.stringify(incoming()) })).status).toBe(
    401
  )
  expect(inbox.enqueue).toHaveBeenCalledTimes(1)
})

it('returns 503 if durable queue persistence fails so delivery can retry', async () => {
  inbox.enqueue.mockRejectedValueOnce(new Error('disk unavailable'))
  const raw = JSON.stringify(incoming())
  const signature =
    'sha256=' +
    createHmac('sha256', config.appSecret ?? '')
      .update(raw)
      .digest('hex')
  expect(
    (
      await fetch(base + '/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
        body: raw
      })
    ).status
  ).toBe(503)
})

it('lets members read non-secret connection settings for replies while restricting configuration changes', async () => {
  getLogin.mockResolvedValue({ workspace: 'ws', account: 'member', role: AccountRole.User })
  store.get.mockResolvedValue({ data: { phoneNumberId: '100001', wabaId: '200001', accessToken: 'hidden' } })
  const headers = { Authorization: 'Bearer local-test', 'Content-Type': 'application/json' }
  const state = await fetch(base + '/api/connection', { headers })
  expect(state.status).toBe(200)
  expect(await state.text()).not.toContain('hidden')
  expect((await fetch(base + '/api/connection', { headers, method: 'DELETE' })).status).toBe(403)
  expect(store.disconnect).not.toHaveBeenCalled()
})

it('lists only sendable approved templates with the server-side token', async () => {
  getLogin.mockResolvedValue({ workspace: 'ws', account: 'member', role: AccountRole.User })
  store.get.mockResolvedValue({ data: { phoneNumberId: '100001', wabaId: '200001' } })
  store.accessToken.mockResolvedValue('server-only-token')
  graphRequest.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [
        {
          name: 'b_followup',
          language: 'zh_CN',
          status: 'APPROVED',
          components: [{ type: 'BODY', text: '您好 {{1}}' }]
        },
        { name: 'a_thanks', language: 'en_US', status: 'APPROVED', components: [{ type: 'BODY', text: 'Thanks' }] },
        { name: 'draft', language: 'en_US', status: 'PENDING', components: [{ type: 'BODY', text: 'x' }] },
        {
          name: 'header_var',
          language: 'en_US',
          status: 'APPROVED',
          components: [
            { type: 'HEADER', format: 'TEXT', text: 'Order {{1}}' },
            { type: 'BODY', text: 'Ready' }
          ]
        },
        { name: 'named', language: 'en_US', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{name}}' }] },
        {
          name: 'image_header',
          language: 'en_US',
          status: 'APPROVED',
          components: [
            { type: 'HEADER', format: 'IMAGE' },
            { type: 'BODY', text: 'x' }
          ]
        }
      ]
    })
  })
  const response = await fetch(base + '/api/templates', { headers: { Authorization: 'Bearer local-test' } })
  expect(response.status).toBe(200)
  const text = await response.text()
  expect(text).not.toContain('server-only-token')
  expect(JSON.parse(text).templates).toEqual([
    { name: 'a_thanks', language: 'en_US', body: 'Thanks', parameterCount: 0 },
    { name: 'b_followup', language: 'zh_CN', body: '您好 {{1}}', parameterCount: 1 }
  ])
  const [url, init] = graphRequest.mock.calls[0]
  expect(url).toContain('http://localhost:2/mock/200001/message_templates?status=APPROVED')
  expect(init.headers).toMatchObject({ Authorization: 'Bearer server-only-token' })
})

it('reports template errors with fixed text and refuses when not connected', async () => {
  store.get.mockResolvedValue({ data: { phoneNumberId: '100001', wabaId: '200001' } })
  store.accessToken.mockResolvedValue('server-only-token')
  graphRequest.mockResolvedValue({
    ok: false,
    status: 401,
    json: async () => ({ error: { code: 190, message: 'provider text server-only-token' } })
  })
  const failed = await fetch(base + '/api/templates', { headers: { Authorization: 'Bearer local-test' } })
  expect(failed.status).toBe(502)
  const body = await failed.text()
  expect(body).not.toContain('server-only-token')
  expect(JSON.parse(body)).toMatchObject({ code: 'TemplatesFailed', errorCode: '190' })
  store.get.mockResolvedValue(undefined)
  expect((await fetch(base + '/api/templates', { headers: { Authorization: 'Bearer local-test' } })).status).toBe(409)
})
