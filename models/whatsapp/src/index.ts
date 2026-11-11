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

import type { Domain } from '@hcengineering/core'
import { type Builder, Model, Prop, TypeString, TypeTimestamp } from '@hcengineering/model'
import core, { TAttachedDoc } from '@hcengineering/model-core'
import setting from '@hcengineering/setting'
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

  wamid?: string
  errorCode?: string
  errorMessage?: string
  templateName?: string
  templateLanguage?: string
  templateParameters?: string[]
}

export function createModel (builder: Builder): void {
  builder.createModel(TWhatsappMessage)
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
