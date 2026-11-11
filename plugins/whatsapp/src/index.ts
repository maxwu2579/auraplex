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

import type { AttachedDoc, Class, IntegrationKind, Ref, Timestamp } from '@hcengineering/core'
import { plugin, type Plugin, type IntlString, type Metadata } from '@hcengineering/platform'
import type { IntegrationType, Handler } from '@hcengineering/setting'
import type { AnyComponent } from '@hcengineering/ui'
import type { NotificationGroup, NotificationType } from '@hcengineering/notification'

export const whatsappId = 'whatsapp' as Plugin
export const whatsappIntegrationKind = 'whatsapp' as IntegrationKind
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'received'

export interface WhatsappMessage extends AttachedDoc {
  content: string
  direction: 'incoming' | 'outgoing'
  status: MessageStatus
  phone: string
  phoneNumberId: string
  sendOn: Timestamp
  wamid?: string
  errorCode?: string
  errorMessage?: string
  templateName?: string
  templateLanguage?: string
  templateParameters?: string[]
}

export default plugin(whatsappId, {
  class: { Message: '' as Ref<Class<WhatsappMessage>> },
  integrationType: { Whatsapp: '' as Ref<IntegrationType> },
  metadata: { WhatsappURL: '' as Metadata<string> },
  ids: { NotificationGroup: '' as Ref<NotificationGroup>, NewMessageNotification: '' as Ref<NotificationType> },
  component: {
    Chat: '' as AnyComponent,
    Connect: '' as AnyComponent,
    State: '' as AnyComponent,
    Icon: '' as AnyComponent
  },
  handler: { Disconnect: '' as Handler },
  string: {
    ChannelLabel: '' as IntlString,
    NewMessage: '' as IntlString,
    Messages: '' as IntlString,
    NoMessages: '' as IntlString,
    ReadOnlyHint: '' as IntlString,
    Whatsapp: '' as IntlString,
    Description: '' as IntlString,
    Connect: '' as IntlString,
    Disconnect: '' as IntlString,
    Save: '' as IntlString,
    Cancel: '' as IntlString,
    PhoneNumberId: '' as IntlString,
    WabaId: '' as IntlString,
    AccessToken: '' as IntlString,
    TokenHint: '' as IntlString,
    Webhook: '' as IntlString,
    Connected: '' as IntlString,
    LocalMode: '' as IntlString,
    TokenStored: '' as IntlString,
    Unavailable: '' as IntlString,
    InvalidParameters: '' as IntlString,
    Forbidden: '' as IntlString,
    Conflict: '' as IntlString,
    Failed: '' as IntlString,
    Message: '' as IntlString,
    Content: '' as IntlString,
    Direction: '' as IntlString,
    Status: '' as IntlString,
    SentOn: '' as IntlString,
    Phone: '' as IntlString,
    Error: '' as IntlString,
    Pending: '' as IntlString,
    Incoming: '' as IntlString
  }
})
