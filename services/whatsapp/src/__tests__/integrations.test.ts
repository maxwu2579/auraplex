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

import type { AccountClient, Integration } from '@hcengineering/account-client'
import type { PersonId, WorkspaceUuid } from '@hcengineering/core'
import { randomBytes } from 'crypto'
import { sessionName, WahaClient } from '../waha'
import { ConnectionStore, validIds } from '../integrations'

it('accepts only numeric identifiers', () => {
  expect(validIds({ phoneNumberId: '123', wabaId: '456' })).toBe(true)
  expect(validIds({ phoneNumberId: '../123', wabaId: '456' })).toBe(false)
  expect(validIds({ phoneNumberId: '', wabaId: '456' })).toBe(false)
})

it('rolls back the public record when storing a secret fails', async () => {
  const account = {
    listIntegrations: jest.fn().mockResolvedValue([]),
    createIntegration: jest.fn(),
    addIntegrationSecret: jest.fn().mockRejectedValue(new Error('storage unavailable')),
    deleteIntegration: jest.fn()
  }
  const store = new ConnectionStore(account as unknown as AccountClient)
  await expect(
    store.connect('ws' as WorkspaceUuid, 'person' as PersonId, { phoneNumberId: '123', wabaId: '456' }, 'local-test')
  ).rejects.toThrow()
  expect(account.deleteIntegration).toHaveBeenCalledTimes(1)
  expect(account.createIntegration.mock.calls[0][0].data).toMatchObject({
    phoneNumberId: '123',
    wabaId: '456',
    connectedOn: expect.any(Number)
  })
})

it('serializes competing connections and rejects duplicate numbers', async () => {
  const entries: Integration[] = []
  const account = {
    listIntegrations: jest.fn(async () => [...entries]),
    createIntegration: jest.fn(async (value: Integration) => {
      entries.push(value)
    }),
    addIntegrationSecret: jest.fn()
  }
  const store = new ConnectionStore(account as unknown as AccountClient)
  const ids = { phoneNumberId: '123', wabaId: '456' }
  const results = await Promise.allSettled([
    store.connect('ws' as WorkspaceUuid, 'person' as PersonId, ids, 'local-test'),
    store.connect('ws' as WorkspaceUuid, 'other' as PersonId, ids, 'local-test')
  ])
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
  await expect(store.connect('other-ws' as WorkspaceUuid, 'person' as PersonId, ids, 'local-test')).rejects.toThrow(
    'CONFLICT'
  )
  expect(entries).toHaveLength(1)
})

it('allows different numbers in a workspace and only disconnects the caller', async () => {
  const entries: Integration[] = []
  const account = {
    listIntegrations: jest.fn(async () => [...entries]),
    createIntegration: jest.fn(async (value: Integration) => {
      entries.push(value)
    }),
    addIntegrationSecret: jest.fn(),
    deleteIntegration: jest.fn()
  }
  const store = new ConnectionStore(account as unknown as AccountClient)
  const ws = 'ws' as WorkspaceUuid
  const a = 'a' as PersonId
  const b = 'b' as PersonId
  await store.connect(ws, a, { phoneNumberId: '123', wabaId: '456' }, 'fake')
  await store.connect(ws, b, { phoneNumberId: '124', wabaId: '457' }, 'fake')
  expect(await store.get(ws, a)).toMatchObject({ socialId: a, data: { phoneNumberId: '123' } })
  await expect(store.connect(ws, a, { phoneNumberId: '124', wabaId: '457' }, 'fake')).rejects.toThrow('CONFLICT')
  await store.disconnect(ws, a)
  expect(account.deleteIntegration).toHaveBeenCalledTimes(1)
  expect(account.deleteIntegration).toHaveBeenCalledWith(expect.objectContaining({ socialId: a }))
})

it('rejects a WAHA number already reserved by a different connection', async () => {
  const entries = [
    { workspaceUuid: 'ws', socialId: 'someone', data: { wahaSession: 'other', wahaPhone: '15550100001' } },
    { workspaceUuid: 'ws', socialId: 'owner', data: { wahaSession: 'new', wahaStatus: 'STARTING' } }
  ]
  const updateIntegration = jest.fn().mockResolvedValue(undefined)
  const store = new ConnectionStore({ listIntegrations: async () => entries, updateIntegration } as any)
  await expect(store.updateWaha('new', 'WORKING', '15550100001')).rejects.toThrow('Conflict')
  expect(updateIntegration).toHaveBeenCalledWith(expect.objectContaining({
    socialId: 'owner', data: expect.objectContaining({ wahaStatus: 'CONFLICT' })
  }))
})

it('replaces a rejected scoped key once and revokes the persisted key on unlink', async () => {
  const first = randomBytes(16).toString('hex')
  const second = randomBytes(16).toString('hex')
  const allocator = randomBytes(16).toString('hex')
  const name = sessionName('fake', 'fake-social')
  const entry = { workspaceUuid: 'fake', socialId: 'fake-social', data: { wahaSession: name, wahaStatus: 'WORKING' } } as any
  let saved = { secret: JSON.stringify({ id: 'old-id', key: first }) }
  const drop = jest.fn()
  const account = {
    listIntegrations: async () => [entry],
    getIntegrationSecret: async () => saved,
    updateIntegrationSecret: async (value: typeof saved) => { saved = value },
    deleteIntegrationSecret: drop
  }
  const requests = jest.fn(async (url: URL, init: RequestInit) => {
    if (url.pathname === '/api/keys' && init.method === 'POST') {
      return Response.json({ id: 'new-id', key: second })
    }
    if (url.pathname.startsWith('/api/keys/') && init.method === 'DELETE') return new Response('', { status: 200 })
    if (url.pathname === '/api/sendText') {
      if (new Headers(init.headers).get('X-Api-Key') === first) return new Response('', { status: 401 })
      return Response.json({ id: 'sent' })
    }
    throw new Error('Unexpected synthetic request')
  })
  const config = { port: 0, accountsUrl: '', publicUrl: '', secret: '', graphVersion: '',
    graphUrl: '', allowedOrigins: [], wahaUrl: 'http://127.0.0.1:1', wahaApiKey: allocator }
  const request = requests as unknown as typeof fetch
  const store = new ConnectionStore(account as any)
  expect(await store.wahaRequest(entry, config, request,
    async (scoped) => await new WahaClient(scoped, request).send(name, '15550100001', 'synthetic'))).toBe('sent')
  expect(requests.mock.calls.filter(([url]) => url.pathname === '/api/keys')).toHaveLength(1)
  expect(requests.mock.calls.filter(([url]) => url.pathname === '/api/sendText')).toHaveLength(2)
  await store.revokeWahaKey(entry, new WahaClient(config, request))
  expect(drop).toHaveBeenCalledTimes(1)
})
