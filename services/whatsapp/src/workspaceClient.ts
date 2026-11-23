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

import { recordWhatsappExchange } from './audit'
import { createHash } from 'crypto'
import type { AccountClient, Integration } from '@hcengineering/account-client'
import contact, { AvatarType, type Channel, type Contact, type PersonSpace } from '@hcengineering/contact'
import core, {
  TxOperations,
  systemAccountUuid,
  type AccountUuid,
  type Client,
  type Doc,
  type Ref,
  type WorkspaceUuid,
  type ApplyOperations
} from '@hcengineering/core'
import notification, { type DocNotifyContext, type CommonInboxNotification } from '@hcengineering/notification'
import { createClient, getTransactorEndpoint } from '@hcengineering/server-client'
import { generateToken } from '@hcengineering/server-token'
import whatsapp, { type WhatsappMessage } from '@hcengineering/whatsapp'
import type { ConnectionStore } from './integrations'
import { normalizePhone, type IncomingMessage, type MessageStatusUpdate, type WebhookBatch } from './webhook'

export function stableId<T extends Doc> (kind: string, ...parts: string[]): Ref<T> {
  return ('whatsapp-' + kind + '-' + createHash('sha256').update(JSON.stringify(parts)).digest('hex')) as Ref<T>
}

export class WorkspaceReceiver {
  private readonly clients = new Map<WorkspaceUuid, Promise<TxOperations>>()
  constructor (
    private readonly account: AccountClient,
    private readonly store: ConnectionStore
  ) {}

  async getClient (workspace: WorkspaceUuid): Promise<TxOperations> {
    let pending = this.clients.get(workspace)
    if (pending === undefined) {
      pending = (async () => {
        const token = generateToken(systemAccountUuid, workspace, { service: 'whatsapp' })
        const endpoint = await getTransactorEndpoint(token, 'internal', 15000)
        const raw: Client = await createClient(endpoint, token, undefined, 15000)
        return new TxOperations(raw, core.account.System)
      })()
      this.clients.set(workspace, pending)
    }
    try {
      return await pending
    } catch (err) {
      this.clients.delete(workspace)
      throw err
    }
  }

  // Auraplex: send just one inbox notification per disconnected connection, only to its owner.
  async notifyDisconnected (integration?: Integration): Promise<void> {
    if (integration?.workspaceUuid == null) return
    const user = await this.account.findPersonBySocialId(integration.socialId, true) as AccountUuid | undefined
    if (user === undefined) return
    const client = await this.getClient(integration.workspaceUuid)
    const person = await client.findOne(contact.mixin.Employee, { personUuid: user, active: true })
    if (person === undefined) return
    const space = await client.findOne(contact.class.PersonSpace, { person: person._id })
    if (space === undefined || !space.private || !space.members.includes(user)) return
    const id = stableId<CommonInboxNotification>('waha-disconnected', user, String(integration.data?.wahaConnectedOn ?? ''))
    if (await client.findOne(notification.class.CommonInboxNotification, { _id: id }) !== undefined) return
    const ops = client.apply('whatsapp-disconnected')
    ops.notMatch(notification.class.CommonInboxNotification, { _id: id })
    const existing = await client.findOne(notification.class.DocNotifyContext, { user, objectId: person._id })
    const context = existing?._id ?? stableId<DocNotifyContext>('waha-context', user)
    if (existing === undefined) {
      ops.notMatch(notification.class.DocNotifyContext, { _id: context })
      await ops.createDoc(notification.class.DocNotifyContext, space._id, {
        user, objectId: person._id, objectClass: person._class, objectSpace: person.space,
        hidden: false, isPinned: false, lastUpdateTimestamp: Date.now()
      }, context)
    }
    await ops.createDoc(notification.class.CommonInboxNotification, space._id, {
      user, objectId: person._id, objectClass: person._class, docNotifyContext: context,
      isViewed: false, archived: false, header: whatsapp.string.WahaDisconnected
    }, id)
    if (!(await ops.commit()).result &&
      await client.findOne(notification.class.CommonInboxNotification, { _id: id }) === undefined) {
      throw new Error('Could not record disconnect notification')
    }
  }

  async consume (batch: WebhookBatch): Promise<void> {
    for (const message of batch.messages) {
      const integration = message.session === undefined
        ? await this.store.findByPhoneNumberId(message.phoneNumberId)
        : await this.store.findWaha(message.session)
      if (integration?.workspaceUuid == null) continue
      await this.receive(await this.getClient(integration.workspaceUuid), integration, message)
    }
    for (const status of batch.statuses) {
      const integration = status.session === undefined
        ? await this.store.findByPhoneNumberId(status.phoneNumberId)
        : await this.store.findWaha(status.session)
      if (integration?.workspaceUuid == null) continue
      await this.updateStatus(await this.getClient(integration.workspaceUuid), status)
    }
  }

  async receive (client: TxOperations, integration: Integration, message: IncomingMessage): Promise<void> {
    const id = stableId<WhatsappMessage>('message', message.session ?? message.phoneNumberId, message.wamid)
    if ((await client.findOne(whatsapp.class.Message, { _id: id })) !== undefined) return
    const owner = (await this.account.findPersonBySocialId(integration.socialId, true)) as AccountUuid | undefined
    if (owner === undefined) throw new Error('Missing integration owner')
    const employee = await client.findOne(contact.mixin.Employee, { personUuid: owner, active: true })
    const personalSpace =
      employee === undefined ? undefined : await client.findOne(contact.class.PersonSpace, { person: employee._id })
    if (personalSpace === undefined || !personalSpace.private || !personalSpace.members.includes(owner)) {
      throw new Error('Missing private integration space')
    }
    // Auraplex: wait for a concurrent service send to persist its provider ID before recording its echo.
    const echo = { owner, phoneNumberId: message.phoneNumberId, phone: message.phone, direction: 'outgoing' as const }
    if (message.outgoing === true) {
      if (await client.findOne(whatsapp.class.Message, { ...echo, wamid: message.wamid }) !== undefined) return
      if (await client.findOne(whatsapp.class.Message, { ...echo, status: 'sending' }) !== undefined) {
        throw new Error('Waiting for outgoing message ID')
      }
    }
    const ops = client.apply('whatsapp-incoming')
    ops.notMatch(whatsapp.class.Message, { _id: id })
    let channel = await client.findOne(contact.class.Channel, {
      provider: contact.channelProvider.Whatsapp,
      value: message.phone
    })
    if (channel === undefined) {
      channel = (await client.findAll(contact.class.Channel, { provider: contact.channelProvider.Whatsapp })).find(
        (entry) => normalizePhone(entry.value) === message.phone
      )
    }
    let customer: Contact | undefined
    if (channel !== undefined) {
      customer = await client.findOne(contact.class.Contact, { _id: channel.attachedTo as Ref<Contact> })
      if (customer === undefined) throw new Error('Missing channel contact')
    } else {
      const personId = stableId<Contact>('person', message.phone)
      customer = await client.findOne(contact.class.Contact, { _id: personId })
      if (customer === undefined) {
        await ops.createDoc(
          contact.class.Person,
          contact.space.Contacts,
          {
            name: message.name,
            avatarType: AvatarType.COLOR,
            avatarProps: { color: '#25D366' },
            city: '',
            channels: 0,
            attachments: 0,
            comments: 0
          },
          personId
        )
      }
      const channelId = stableId<Channel>('channel', message.phone)
      await ops.addCollection(
        contact.class.Channel,
        customer?.space ?? contact.space.Contacts,
        personId,
        customer?._class ?? contact.class.Person,
        'channels',
        {
          provider: contact.channelProvider.Whatsapp,
          value: message.phone
        },
        channelId
      )
      channel = {
        _id: channelId,
        _class: contact.class.Channel,
        space: customer?.space ?? contact.space.Contacts,
        attachedTo: personId,
        attachedToClass: customer?._class ?? contact.class.Person,
        collection: 'channels',
        provider: contact.channelProvider.Whatsapp,
        value: message.phone,
        modifiedBy: core.account.System,
        modifiedOn: Date.now()
      }
      customer ??= {
        _id: personId,
        _class: contact.class.Person,
        space: contact.space.Contacts,
        name: message.name,
        avatarType: AvatarType.COLOR,
        modifiedBy: core.account.System,
        modifiedOn: Date.now()
      }
    }
    await ops.addCollection(
      whatsapp.class.Message,
      personalSpace._id,
      channel._id,
      channel._class,
      'items',
      {
        owner,
        content: message.content,
        ...(message.mediaAvailable === true ? { mediaAvailable: true } : {}),
        direction: message.outgoing === true ? 'outgoing' : 'incoming',
        status: message.outgoing === true ? 'sent' : 'received',
        phone: message.phone,
        phoneNumberId: message.phoneNumberId,
        sendOn: message.timestamp,
        wamid: message.wamid
      },
      id
    )
    if (message.outgoing !== true) await this.addNotifications(client, ops, owner, customer, channel, message, id)
    await recordWhatsappExchange(client, ops, owner, message.phone, message.timestamp)
    const result = await ops.commit()
    if (!result.result && (await client.findOne(whatsapp.class.Message, { _id: id })) === undefined) {
      throw new Error('Message transaction was not committed')
    }
  }

  private async addNotifications (
    client: TxOperations,
    ops: ApplyOperations,
    owner: AccountUuid,
    customer: Contact,
    channel: Channel,
    message: IncomingMessage,
    messageId: Ref<WhatsappMessage>
  ): Promise<void> {
    const recipients = [owner]
    const providerSettings = await client.findAll(notification.class.NotificationProviderSetting, {
      attachedTo: notification.providers.InboxNotificationProvider
    })
    const typeSettings = await client.findAll(notification.class.NotificationTypeSetting, {
      attachedTo: notification.providers.InboxNotificationProvider,
      type: whatsapp.ids.NewMessageNotification
    })
    for (const user of recipients) {
      const employee = await client.findOne(contact.mixin.Employee, { personUuid: user, active: true })
      if (employee === undefined) continue
      const identities = await client.findAll(contact.class.SocialIdentity, { attachedTo: employee._id })
      const socialIds = new Set(identities.map((identity) => identity._id as string))
      const disabledProviders = providerSettings.filter(
        (setting) => setting.createdBy !== undefined && socialIds.has(setting.createdBy)
      )
      const typeSetting = typeSettings.find(
        (setting) => setting.createdBy !== undefined && socialIds.has(setting.createdBy)
      )
      if (
        (disabledProviders.length > 0 && disabledProviders.every((setting) => !setting.enabled)) ||
        typeSetting?.enabled === false
      ) {
        continue
      }
      const space = await client.findOne(contact.class.PersonSpace, { person: employee._id })
      if (space === undefined) throw new Error('Missing notification space')
      const context = await client.findOne(notification.class.DocNotifyContext, { objectId: channel._id, user })
      const contextId = context?._id ?? stableId<DocNotifyContext>('context', channel._id, user)
      if (context === undefined) {
        await ops.createDoc(
          notification.class.DocNotifyContext,
          space._id,
          {
            user,
            objectId: channel._id,
            objectClass: channel._class,
            objectSpace: channel.space,
            hidden: false,
            isPinned: false,
            lastUpdateTimestamp: message.timestamp
          },
          contextId
        )
      } else {
        await ops.update(context, {
          hidden: false,
          lastUpdateTimestamp: Math.max(context.lastUpdateTimestamp ?? 0, message.timestamp)
        })
      }
      await ops.createDoc(
        notification.class.CommonInboxNotification,
        space._id as Ref<PersonSpace>,
        {
          user,
          objectId: channel._id,
          objectClass: channel._class,
          docNotifyContext: contextId,
          isViewed: false,
          archived: false,
          header: whatsapp.string.NewMessage,
          headerIcon: contact.icon.Whatsapp,
          headerObjectId: customer._id,
          headerObjectClass: customer._class,
          messageHtml: JSON.stringify({
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: message.content !== '' ? message.content : ' ' }] }
            ]
          }),
          types: [whatsapp.ids.NewMessageNotification]
        },
        stableId('notification', messageId, user)
      )
    }
  }

  private async updateStatus (client: TxOperations, status: MessageStatusUpdate): Promise<void> {
    const message = await client.findOne(whatsapp.class.Message, {
      phoneNumberId: status.phoneNumberId,
      wamid: status.wamid,
      direction: 'outgoing'
    })
    if (message === undefined) {
      // A fast status callback may arrive before the Graph response is saved.
      if (
        (await client.findOne(whatsapp.class.Message, {
          phoneNumberId: status.phoneNumberId,
          direction: 'outgoing',
          status: 'sending'
        })) !== undefined
      ) {
        throw new Error('Waiting for outgoing message ID')
      }
      return
    }
    const rank: Record<string, number> = { pending: 0, sending: 0, sent: 1, delivered: 2, read: 3, failed: 1 }
    if (rank[message.status] > rank[status.status] || message.status === 'read') return
    if (message.status === 'failed' && status.status === 'sent') return
    const ops = client.apply('whatsapp-status')
    ops.match(whatsapp.class.Message, { _id: message._id, status: message.status })
    await ops.update(message, {
      status: status.status,
      errorCode: status.errorCode,
      errorMessage: status.errorMessage
    })
    if (!(await ops.commit()).result) throw new Error('Concurrent status update; retry')
  }

  async close (): Promise<void> {
    for (const pending of this.clients.values()) {
      try {
        await (await pending).close()
      } catch {
        /* Failed connections have no socket to close. */
      }
    }
    this.clients.clear()
  }
}
