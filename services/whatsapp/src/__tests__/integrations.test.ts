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
  expect(account.createIntegration.mock.calls[0][0].data).toEqual({ phoneNumberId: '123', wabaId: '456' })
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
