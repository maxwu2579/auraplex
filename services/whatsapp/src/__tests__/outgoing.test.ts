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

import contact from '@hcengineering/contact'
import core, { type Tx, type TxOperations, type WorkspaceUuid } from '@hcengineering/core'
import whatsapp from '@hcengineering/whatsapp'
import { OutgoingService, outgoingMessageId } from '../outgoing'
import { SendError, sendText } from '../graph'
import type { Config } from '../config'
import type { ConnectionStore } from '../integrations'

const config: Config = {
  graphUrl: 'http://localhost:8097',
  graphVersion: 'mock',
  port: 8098,
  accountsUrl: '',
  secret: '',
  publicUrl: '',
  allowedOrigins: []
}
function fixture (): {
  message: any
  channel: any
  client: TxOperations
  store: any
  request: jest.Mock
  sender: OutgoingService
} {
  const message: any = {
    _id: 'msg',
    _class: whatsapp.class.Message,
    attachedTo: 'channel',
    space: 'contacts',
    content: '你好，产品有货',
    direction: 'outgoing',
    status: 'pending',
    phone: '6588880001',
    phoneNumberId: '100001'
  }
  const channel = {
    _id: 'channel',
    _class: contact.class.Channel,
    value: '+65 (8888) 0001',
    provider: contact.channelProvider.Whatsapp,
    space: 'contacts'
  }
  const records = [message, channel]
  const client: any = {
    findAll: async (cls: string, query: object) =>
      records.filter(
        (doc) =>
          doc._class === cls &&
          Object.entries(query).every(([key, val]) =>
            typeof val === 'object' && val !== null ? doc[key] < (val as { $lt: number }).$lt : doc[key] === val
          )
      ),
    findOne: async (cls: string, query: object) =>
      records.find((doc) => doc._class === cls && Object.entries(query).every(([key, val]) => doc[key] === val)),
    apply: () => {
      let query: object = {}
      let changes: object = {}
      return {
        match: (_cls: string, q: object) => {
          query = q
        },
        update: async (_doc: object, data: object) => {
          changes = data
        },
        commit: async () => {
          if (!Object.entries(query).every(([key, val]) => message[key] === val)) return { result: false }
          Object.assign(message, changes)
          return { result: true }
        }
      }
    }
  }
  const store: any = {
    get: async () => ({ data: { phoneNumberId: '100001' } }),
    accessToken: async () => 'test-secret',
    list: async () => [{ workspaceUuid: 'workspace' }]
  }
  const request = jest.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.reply' }] }) }))
  const sender = new OutgoingService(
    store as ConnectionStore,
    { getClient: async () => client },
    config,
    request as unknown as typeof fetch
  )
  return { message, channel, client: client as TxOperations, store, request, sender }
}
const workspace = 'workspace' as WorkspaceUuid

it('claims once under duplicate queue events and sends formatted channel numbers using the server token', async () => {
  const f = fixture()
  await Promise.all([f.sender.handle(workspace, f.message._id), f.sender.handle(workspace, f.message._id)])
  await f.sender.handle(workspace, f.message._id)
  expect(f.request).toHaveBeenCalledTimes(1)
  const [url, init] = f.request.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('http://localhost:8097/mock/100001/messages')
  expect(JSON.parse(String(init.body))).toMatchObject({ to: '6588880001', text: { body: '你好，产品有货' } })
  expect(init.headers).toMatchObject({ Authorization: 'Bearer test-secret' })
  expect(f.message).toMatchObject({ status: 'sent', wamid: 'wamid.reply' })
})

it('saves safe failure details without leaking provider error text', async () => {
  const f = fixture()
  f.request.mockImplementation(
    async () => ({ ok: false, json: async () => ({ error: { code: 190, message: 'test-secret' } }) }) as any
  )
  await f.sender.handle(workspace, f.message._id)
  expect(f.message).toMatchObject({ status: 'failed', errorCode: '190' })
  expect(f.message.errorMessage).toContain('访问令牌')
  expect(f.message.errorMessage).not.toContain('test-secret')
})

it('does not call Graph for a disconnected integration or tampered destination', async () => {
  const f = fixture()
  f.message.phone = '123'
  await f.sender.handle(workspace, f.message._id)
  expect(f.message.status).toBe('failed')
  expect(f.request).not.toHaveBeenCalled()
  f.message.status = 'pending'
  f.store.get = async () => undefined
  await f.sender.handle(workspace, f.message._id)
  expect(f.message.errorCode).toBe('NOT_CONNECTED')
  expect(f.request).not.toHaveBeenCalled()
})

it('does not automatically resend when transport outcome is unknown', async () => {
  const f = fixture()
  f.request.mockRejectedValue(new Error('test-secret'))
  await f.sender.handle(workspace, f.message._id)
  await f.sender.handle(workspace, f.message._id)
  expect(f.request).toHaveBeenCalledTimes(1)
  expect(f.message).toMatchObject({ status: 'failed', errorCode: 'DELIVERY_UNKNOWN' })
  expect(f.message.errorMessage).not.toContain('test-secret')
})

it('maps a window rejection and rejects missing response IDs safely', async () => {
  await expect(
    sendText(config, 'secret', '100001', '6588880001', 'test', (async () => ({
      ok: false,
      json: async () => ({ error: { code: 131047 } })
    })) as any)
  ).rejects.toThrow('24 小时')
  await expect(
    sendText(config, 'secret', '100001', '6588880001', 'test', (async () => ({
      ok: true,
      json: async () => ({})
    })) as any)
  ).rejects.toBeInstanceOf(SendError)
})

it('recognizes WhatsApp create/update queue events and ignores other document classes', () => {
  expect(
    outgoingMessageId({
      _class: core.class.TxCreateDoc,
      objectClass: whatsapp.class.Message,
      objectId: 'msg'
    } as unknown as Tx)
  ).toBe('msg')
  expect(
    outgoingMessageId({ _class: core.class.TxCreateDoc, objectClass: contact.class.Person } as unknown as Tx)
  ).toBeUndefined()
})

it('recovers pending messages and marks interrupted sends uncertain without resending', async () => {
  const pending = fixture()
  const interrupted = fixture()
  interrupted.message.status = 'sending'
  interrupted.message.attemptOn = Date.now() - 180000
  pending.sender.start()
  interrupted.sender.start()
  try {
    for (let i = 0; i < 50 && interrupted.message.status !== 'failed'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(pending.request).toHaveBeenCalledTimes(1)
    expect(pending.message.status).toBe('sent')
    expect(interrupted.request).not.toHaveBeenCalled()
    expect(interrupted.message).toMatchObject({ status: 'failed', errorCode: 'DELIVERY_UNKNOWN' })
  } finally {
    await pending.sender.close()
    await interrupted.sender.close()
  }
})

it('sends approved templates with body variables and validates them first', async () => {
  const f = fixture()
  Object.assign(f.message, {
    content: '您好 王先生，您咨询的产品 A1 已有新资料。',
    templateName: 'product_followup_zh',
    templateLanguage: 'zh_CN',
    templateParameters: ['王先生', 'A1']
  })
  await f.sender.handle(workspace, f.message._id)
  expect(f.request).toHaveBeenCalledTimes(1)
  const [, init] = f.request.mock.calls[0] as unknown as [string, RequestInit]
  expect(JSON.parse(String(init.body))).toEqual({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '6588880001',
    type: 'template',
    template: {
      name: 'product_followup_zh',
      language: { code: 'zh_CN' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: '王先生' },
            { type: 'text', text: 'A1' }
          ]
        }
      ]
    }
  })
  expect(f.message.status).toBe('sent')

  const bad = fixture()
  Object.assign(bad.message, { templateName: 'x', templateLanguage: 'zh_CN', templateParameters: ['a\nb'] })
  await bad.sender.handle(workspace, bad.message._id)
  expect(bad.request).not.toHaveBeenCalled()
  expect(bad.message).toMatchObject({ status: 'failed', errorCode: 'INVALID_MESSAGE' })
})

it('sends templates without variables without a components list', async () => {
  const f = fixture()
  Object.assign(f.message, {
    content: '感谢',
    templateName: 'thanks_zh',
    templateLanguage: 'zh_CN',
    templateParameters: []
  })
  await f.sender.handle(workspace, f.message._id)
  const [, init] = f.request.mock.calls[0] as unknown as [string, RequestInit]
  expect(JSON.parse(String(init.body)).template).toEqual({ name: 'thanks_zh', language: { code: 'zh_CN' } })
})

it('maps template errors to Chinese hints', async () => {
  const f = fixture()
  Object.assign(f.message, { templateName: 't', templateLanguage: 'zh_CN', templateParameters: [] })
  f.request.mockImplementation(async () => ({ ok: false, json: async () => ({ error: { code: 132000 } }) }) as any)
  await f.sender.handle(workspace, f.message._id)
  expect(f.message).toMatchObject({ status: 'failed', errorCode: '132000' })
  expect(f.message.errorMessage).toContain('模板变量')
})
