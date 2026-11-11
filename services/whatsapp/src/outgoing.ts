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

import contact, { type Channel } from '@hcengineering/contact'
import core, { type Ref, type Tx, type TxCUD, type TxOperations, type WorkspaceUuid } from '@hcengineering/core'
import whatsapp, { isValidTemplateParameter, type WhatsappMessage } from '@hcengineering/whatsapp'
import type { Config } from './config'
import type { ConnectionStore } from './integrations'
import type { WorkspaceReceiver } from './workspaceClient'
import { normalizePhone } from './webhook'
import { SendError, sendTemplate, sendText } from './graph'

export function outgoingMessageId (tx: Tx): Ref<WhatsappMessage> | undefined {
  const cud = tx as TxCUD<WhatsappMessage>
  if (
    (tx._class === core.class.TxCreateDoc || tx._class === core.class.TxUpdateDoc) &&
    cud.objectClass === whatsapp.class.Message
  ) {
    return cud.objectId
  }
  return undefined
}

function validTemplate (message: WhatsappMessage): boolean {
  const parameters = message.templateParameters ?? []
  return (
    typeof message.templateName === 'string' &&
    /^[a-z0-9_]{1,512}$/.test(message.templateName) &&
    typeof message.templateLanguage === 'string' &&
    /^[A-Za-z_]{2,15}$/.test(message.templateLanguage) &&
    Array.isArray(parameters) &&
    parameters.length <= 20 &&
    parameters.every((value) => typeof value === 'string' && isValidTemplateParameter(value))
  )
}

export class OutgoingService {
  private timer: NodeJS.Timeout | undefined
  private scanning: Promise<void> | undefined
  private stopped = false
  private recoveryErrorReported = false
  private readonly active = new Set<Promise<void>>()

  constructor (
    private readonly store: ConnectionStore,
    private readonly receiver: Pick<WorkspaceReceiver, 'getClient'>,
    private readonly config: Config,
    private readonly request: typeof fetch = fetch
  ) {}

  start (): void {
    this.timer = setInterval(() => {
      this.scheduleRecovery()
    }, 30000)
    this.scheduleRecovery()
  }

  private scheduleRecovery (): void {
    if (this.stopped || this.scanning !== undefined) return
    this.scanning = this.recover()
      .catch(() => {
        if (!this.recoveryErrorReported) console.error('WhatsApp pending message recovery is temporarily unavailable')
        this.recoveryErrorReported = true
      })
      .finally(() => {
        this.scanning = undefined
      })
  }

  async handle (workspace: WorkspaceUuid, id: Ref<WhatsappMessage>): Promise<void> {
    if (this.stopped) return
    const task = this.process(workspace, id)
    this.active.add(task)
    try {
      await task
    } finally {
      this.active.delete(task)
    }
  }

  private async process (workspace: WorkspaceUuid, id: Ref<WhatsappMessage>): Promise<void> {
    const client = await this.receiver.getClient(workspace)
    const message = await client.findOne(whatsapp.class.Message, { _id: id, direction: 'outgoing', status: 'pending' })
    if (message !== undefined) await this.deliver(client, workspace, message)
  }

  async deliver (client: TxOperations, workspace: WorkspaceUuid, message: WhatsappMessage): Promise<void> {
    const claim = client.apply('whatsapp-send')
    claim.match(whatsapp.class.Message, { _id: message._id, direction: 'outgoing', status: 'pending' })
    await claim.update(message, { status: 'sending', attemptOn: Date.now() })
    if (!(await claim.commit()).result) return
    let wamid: string | undefined
    let failure: SendError | undefined
    try {
      const integration = await this.store.get(workspace)
      if (integration === undefined) throw new SendError('NOT_CONNECTED', 'WhatsApp 尚未连接，请管理员在设置中连接。')
      const phoneNumberId = integration.data?.phoneNumberId
      const channel = await client.findOne(contact.class.Channel, { _id: message.attachedTo as Ref<Channel> })
      const phone = normalizePhone(channel?.value ?? '')
      if (
        channel?.provider !== contact.channelProvider.Whatsapp ||
        phone === '' ||
        channel.space !== message.space ||
        message.phone !== phone ||
        typeof phoneNumberId !== 'string' ||
        !/^\d+$/.test(phoneNumberId) ||
        message.phoneNumberId !== phoneNumberId ||
        typeof message.content !== 'string' ||
        message.content.trim() === '' ||
        message.content.length > 4096 ||
        (message.templateName !== undefined && !validTemplate(message))
      ) {
        throw new SendError('INVALID_MESSAGE', '消息或号码无效，请检查后重新发送。')
      }
      const token = await this.store.accessToken(integration)
      if (token === undefined || token === '') throw new SendError('190', '访问令牌未配置，请管理员重新连接。')
      wamid =
        message.templateName !== undefined
          ? await sendTemplate(
            this.config,
            token,
            phoneNumberId,
            phone,
            {
              name: message.templateName,
              language: message.templateLanguage ?? '',
              parameters: message.templateParameters ?? []
            },
            this.request
          )
          : await sendText(this.config, token, phoneNumberId, phone, message.content, this.request)
    } catch (err) {
      failure =
        err instanceof SendError ? err : new SendError('SERVICE_UNAVAILABLE', '发送服务暂时不可用，请稍后重新发送。')
    }
    // Keep a failed persistence write in 'sending'. Recovery marks it uncertain instead of sending again.
    const finish = client.apply('whatsapp-send-result')
    finish.match(whatsapp.class.Message, { _id: message._id, status: 'sending' })
    await finish.update(
      message,
      failure === undefined
        ? { status: 'sent', wamid }
        : { status: 'failed', errorCode: failure.code, errorMessage: failure.message }
    )
    if (!(await finish.commit()).result) throw new Error('Send result could not be saved')
  }

  private async recover (): Promise<void> {
    const integrations = await this.store.list()
    for (const integration of integrations) {
      if (this.stopped) break
      if (integration.workspaceUuid == null) continue
      try {
        const client = await this.receiver.getClient(integration.workspaceUuid)
        const pending = await client.findAll(whatsapp.class.Message, { direction: 'outgoing', status: 'pending' })
        for (const message of pending) await this.handle(integration.workspaceUuid, message._id)
        const interrupted = await client.findAll(whatsapp.class.Message, {
          direction: 'outgoing',
          status: 'sending',
          attemptOn: { $lt: Date.now() - 120000 }
        })
        for (const message of interrupted) {
          const ops = client.apply('whatsapp-send-interrupted')
          ops.match(whatsapp.class.Message, { _id: message._id, status: 'sending', attemptOn: message.attemptOn })
          await ops.update(message, {
            status: 'failed',
            errorCode: 'DELIVERY_UNKNOWN',
            errorMessage: '发送过程被中断，无法确认结果，请先核实客户是否收到，再决定是否重新发送。'
          })
          await ops.commit()
        }
      } catch {
        // A removed workspace must not prevent other workspaces from sending.
        continue
      }
    }
    this.recoveryErrorReported = false
  }

  async close (): Promise<void> {
    this.stopped = true
    if (this.timer !== undefined) clearInterval(this.timer)
    await this.scanning
    await Promise.allSettled(this.active)
  }
}
