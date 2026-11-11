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
export type MessageStatus = 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'received'

export interface WhatsappMessage extends AttachedDoc {
  content: string
  direction: 'incoming' | 'outgoing'
  status: MessageStatus
  phone: string
  phoneNumberId: string
  sendOn: Timestamp
  wamid?: string
  attemptOn?: Timestamp
  errorCode?: string
  errorMessage?: string
  templateName?: string
  templateLanguage?: string
  templateParameters?: string[]
}

/** Meta only accepts free-form replies within 24 hours of the customer's last message. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000

/** An approved message template that Huly can send (body variables only). */
export interface WhatsappTemplate {
  name: string
  language: string
  body: string
  parameterCount: number
}

/** Time of the customer's most recent message, or `undefined` if they never wrote. */
export function lastIncomingAt (messages: Array<Pick<WhatsappMessage, 'direction' | 'sendOn'>>): number | undefined {
  let last: number | undefined
  for (const message of messages) {
    if (message.direction === 'incoming' && (last === undefined || message.sendOn > last)) last = message.sendOn
  }
  return last
}

/**
 * Free-form text is allowed only while the window is open. A customer who
 * never wrote has no open window, so only templates can start the chat.
 */
export function isReplyWindowOpen (
  lastIncoming: number | undefined,
  now: number,
  windowMs: number = REPLY_WINDOW_MS
): boolean {
  return lastIncoming !== undefined && now - lastIncoming < windowMs
}

/**
 * Number of positional variables ({{1}}, {{2}}, …) in a template body.
 * Returns -1 for named variables ({{name}}), which this version does not support.
 */
export function templateParameterCount (body: string): number {
  let max = 0
  for (const match of body.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
    if (!/^[1-9]\d{0,1}$/.test(match[1])) return -1
    max = Math.max(max, Number(match[1]))
  }
  return max
}

/** Template body with {{n}} replaced by the given values; empty values keep the placeholder. */
export function renderTemplate (body: string, parameters: string[]): string {
  return body.replace(/\{\{\s*([1-9]\d{0,1})\s*\}\}/g, (whole, n: string) => {
    const value = parameters[Number(n) - 1]
    return value !== undefined && value !== '' ? value : whole
  })
}

/** Meta rejects template variables that contain new lines, tabs or more than 4 spaces in a row. */
export function isValidTemplateParameter (value: string): boolean {
  return value.trim() !== '' && value.length <= 1024 && !/[\n\r\t]/.test(value) && !/ {5,}/.test(value)
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
    Incoming: '' as IntlString,
    Send: '' as IntlString,
    Reply: '' as IntlString,
    Sending: '' as IntlString,
    Sent: '' as IntlString,
    Delivered: '' as IntlString,
    Read: '' as IntlString,
    SendFailed: '' as IntlString,
    SaveMessageFailed: '' as IntlString,
    ConnectionRequired: '' as IntlString,
    WindowClosed: '' as IntlString,
    NeverWrote: '' as IntlString,
    Template: '' as IntlString,
    ChooseTemplate: '' as IntlString,
    TemplateParameter: '' as IntlString,
    TemplatePreview: '' as IntlString,
    NoTemplates: '' as IntlString,
    TemplatesFailed: '' as IntlString,
    LoadingTemplates: '' as IntlString,
    InvalidTemplateParameter: '' as IntlString
  }
})
