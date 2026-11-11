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
import contact from '@hcengineering/contact'
import core, { type Doc, type TxOperations, type PersonId, type WorkspaceUuid } from '@hcengineering/core'
import notification from '@hcengineering/notification'
import whatsapp, { whatsappIntegrationKind } from '@hcengineering/whatsapp'
import { WorkspaceReceiver } from '../workspaceClient'
import type { ConnectionStore } from '../integrations'
import type { IncomingMessage } from '../webhook'

function fixture (): { client: TxOperations, receiver: WorkspaceReceiver, records: () => any[], failNext: () => void } {
  const records: any[] = [
    { _id: 'customer', _class: contact.class.Person, name: 'Existing name', space: 'contacts' },
    {
      _id: 'old-channel',
      _class: contact.class.Channel,
      attachedTo: 'customer',
      attachedToClass: contact.class.Person,
      space: 'contacts',
      value: '+65 (8888) 0001',
      provider: contact.channelProvider.Whatsapp
    },
    ...['owner', 'follower', 'unrelated'].flatMap((user) => [
      { _id: user + '-person', _class: contact.class.Person, personUuid: user, active: true, employee: true },
      { _id: user + '-space', _class: contact.class.PersonSpace, person: user + '-person' }
    ]),
    { _id: 'watch-1', _class: core.class.Collaborator, attachedTo: 'customer', collaborator: 'owner' },
    { _id: 'watch-2', _class: core.class.Collaborator, attachedTo: 'customer', collaborator: 'follower' }
  ]
  let fail = false
  const matches = (doc: any, cls: string, query: object): boolean =>
    (doc._class === cls ||
      (cls === contact.class.Contact && doc._class === contact.class.Person) ||
      (cls === contact.mixin.Employee && doc.employee === true)) &&
    Object.entries(query).every(([key, value]) => doc[key] === value)
  const client: any = {
    findOne: async (cls: string, query: object) => records.find((doc) => matches(doc, cls, query)),
    findAll: async (cls: string, query: object) => records.filter((doc) => matches(doc, cls, query)),
    apply: () => {
      const changes: Array<() => void> = []
      const ops: any = {
        notMatch: () => ops,
        createDoc: async (cls: string, space: string, data: object, id: string) => {
          changes.push(() => records.push({ _id: id, _class: cls, space, ...data }))
          return id
        },
        addCollection: async (
          cls: string,
          space: string,
          parent: string,
          parentClass: string,
          collection: string,
          data: object,
          id: string
        ) => {
          changes.push(() =>
            records.push({
              _id: id,
              _class: cls,
              space,
              attachedTo: parent,
              attachedToClass: parentClass,
              collection,
              ...data
            })
          )
          return id
        },
        update: async (doc: Doc, data: object) => {
          changes.push(() =>
            Object.assign(
              records.find((r) => r._id === doc._id),
              data
            )
          )
        },
        commit: async () => {
          if (fail) {
            fail = false
            throw new Error('Retryable failure')
          }
          changes.forEach((change) => {
            change()
          })
          return { result: true }
        }
      }
      return ops
    }
  }
  const account = { findPersonBySocialId: async () => 'owner' }
  const store = {}
  const receiver = new WorkspaceReceiver(account as unknown as AccountClient, store as ConnectionStore)
  return {
    client: client as TxOperations,
    receiver,
    records: () => records,
    failNext: () => {
      fail = true
    }
  }
}
const integration: Integration = {
  socialId: 'social' as PersonId,
  kind: whatsappIntegrationKind,
  workspaceUuid: 'workspace' as WorkspaceUuid
}
const incoming: IncomingMessage = {
  phoneNumberId: '100001',
  wamid: 'wamid.unique',
  phone: '6588880001',
  name: 'Remote name',
  content: '<script>你好</script>',
  timestamp: 1700000000000
}

it('matches old formatted numbers without changing them and notifies owner plus followers once', async () => {
  const f = fixture()
  await f.receiver.receive(f.client, integration, incoming)
  const messages = f.records().filter((doc) => doc._class === whatsapp.class.Message)
  expect(messages).toHaveLength(1)
  expect(messages[0]).toMatchObject({ attachedTo: 'old-channel', content: incoming.content, status: 'received' })
  expect(f.records().find((doc) => doc._id === 'old-channel').value).toBe('+65 (8888) 0001')
  expect(f.records().find((doc) => doc._id === 'customer').name).toBe('Existing name')
  const notifications = f.records().filter((doc) => doc._class === notification.class.CommonInboxNotification)
  expect(notifications.map((doc) => doc.user).sort((a, b) => a.localeCompare(b))).toEqual(['follower', 'owner'])
  expect(notifications.every((doc) => doc.space === doc.user + '-space')).toBe(true)
  expect(JSON.parse(notifications[0].messageHtml).content[0].content[0]).toEqual({
    type: 'text',
    text: incoming.content
  })
  await f.receiver.receive(f.client, integration, incoming)
  expect(f.records().filter((doc) => doc._class === whatsapp.class.Message)).toHaveLength(1)
  expect(f.records().filter((doc) => doc._class === notification.class.CommonInboxNotification)).toHaveLength(2)
})

it('creates one new contact and channel for an unknown number and reuses them', async () => {
  const f = fixture()
  await f.receiver.receive(f.client, integration, { ...incoming, phone: '6012345678', name: 'New customer' })
  await f.receiver.receive(f.client, integration, {
    ...incoming,
    phone: '6012345678',
    name: 'New customer',
    wamid: 'second'
  })
  expect(f.records().filter((doc) => doc._class === contact.class.Person && doc.name === 'New customer')).toHaveLength(
    1
  )
  expect(f.records().filter((doc) => doc._class === contact.class.Channel && doc.value === '6012345678')).toHaveLength(
    1
  )
  expect(f.records().filter((doc) => doc._class === whatsapp.class.Message)).toHaveLength(2)
})

it('keeps contact, message and notifications consistent when commit fails and is retried', async () => {
  const f = fixture()
  const original = f.records().length
  f.failNext()
  await expect(f.receiver.receive(f.client, integration, { ...incoming, phone: '6012345678' })).rejects.toThrow()
  expect(f.records()).toHaveLength(original)
  await f.receiver.receive(f.client, integration, { ...incoming, phone: '6012345678' })
  expect(f.records().filter((doc) => doc._class === whatsapp.class.Message)).toHaveLength(1)
})
