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

import { type Domain, IndexKind } from '@hcengineering/core'
import { type Builder, Model, Prop, TypeString, TypeTimestamp, Index } from '@hcengineering/model'
import core, { TAttachedDoc } from '@hcengineering/model-core'
import setting from '@hcengineering/setting'
import contact from '@hcengineering/contact'
import notification from '@hcengineering/notification'
import whatsapp, { whatsappIntegrationKind, type WhatsappMessage } from '@hcengineering/whatsapp'

export { whatsappId } from '@hcengineering/whatsapp'
export default whatsapp
export const DOMAIN_WHATSAPP = 'whatsapp' as Domain

@Model(whatsapp.class.Message, core.class.AttachedDoc, DOMAIN_WHATSAPP)
export class TWhatsappMessage extends TAttachedDoc implements WhatsappMessage {
  @Prop(TypeString(), whatsapp.string.Content)
    content!: string

  @Prop(TypeString(), whatsapp.string.Direction)
    direction!: WhatsappMessage['direction']

  @Prop(TypeString(), whatsapp.string.Status)
    status!: WhatsappMessage['status']

  @Prop(TypeString(), whatsapp.string.Phone)
    phone!: string

  @Prop(TypeString(), whatsapp.string.PhoneNumberId)
    phoneNumberId!: string

  @Prop(TypeTimestamp(), whatsapp.string.SentOn)
    sendOn!: number

  @Prop(TypeString(), whatsapp.string.Message)
  @Index(IndexKind.Indexed)
    wamid?: string

  errorCode?: string
  attemptOn?: number
  errorMessage?: string
  templateName?: string
  templateLanguage?: string
  templateParameters?: string[]
}

export function createModel (builder: Builder): void {
  builder.createModel(TWhatsappMessage)
  builder.createDoc(
    contact.class.ChannelProvider,
    core.space.Model,
    {
      label: whatsapp.string.ChannelLabel,
      icon: contact.icon.Whatsapp,
      placeholder: whatsapp.string.Phone,
      presenter: whatsapp.component.Chat,
      integrationType: whatsapp.integrationType.Whatsapp
    },
    contact.channelProvider.Whatsapp
  )
  builder.createDoc(
    notification.class.NotificationGroup,
    core.space.Model,
    {
      label: whatsapp.string.Whatsapp,
      icon: contact.icon.Whatsapp
    },
    whatsapp.ids.NotificationGroup
  )
  // The receiver explicitly targets the integration owner and contact followers.
  // Empty txClasses avoids a second automatic notification for the same message.
  builder.createDoc(
    notification.class.NotificationType,
    core.space.Model,
    {
      label: whatsapp.string.NewMessage,
      generated: false,
      allowedForAuthor: true,
      hidden: false,
      txClasses: [],
      objectClass: whatsapp.class.Message,
      group: whatsapp.ids.NotificationGroup,
      defaultEnabled: true
    },
    whatsapp.ids.NewMessageNotification
  )
  builder.createDoc(
    setting.class.IntegrationType,
    core.space.Model,
    {
      label: whatsapp.string.Whatsapp,
      description: whatsapp.string.Description,
      icon: whatsapp.component.Icon,
      allowMultiple: false,
      kind: whatsappIntegrationKind,
      createComponent: whatsapp.component.Connect,
      configureComponent: whatsapp.component.Connect,
      reconnectComponent: whatsapp.component.Connect,
      stateComponent: whatsapp.component.State,
      onDisconnect: whatsapp.handler.Disconnect
    },
    whatsapp.integrationType.Whatsapp
  )
}
