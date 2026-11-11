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

import { templateParameterCount, type WhatsappTemplate } from '@hcengineering/whatsapp'
import type { Config } from './config'

export class SendError extends Error {
  constructor (
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export function graphError (code: string): SendError {
  if (code === '190') return new SendError(code, '访问令牌无效或已过期，请管理员重新配置连接。')
  if (code === '131047') return new SendError(code, '超过 24 小时回复窗口，请使用已审核的模板消息。')
  if (code === '10' || code === '200') return new SendError(code, '账号没有发送权限，请管理员检查配置。')
  if (code === '132000') return new SendError(code, '模板变量数量不对，请检查后重新发送。')
  if (code === '132001') return new SendError(code, '找不到这个模板或这个语言版本，请到 Meta 后台确认模板已审核通过。')
  if (code === '132015' || code === '132016') return new SendError(code, '这个模板已被暂停或停用，请换一个模板。')
  if (code === '130429' || code === '131048') return new SendError(code, '发送过于频繁，请稍后再试。')
  return new SendError(code, '消息发送失败，请检查账号配置或稍后重试。')
}

export interface TemplateMessage {
  name: string
  language: string
  parameters: string[]
}

function graphBase (config: Pick<Config, 'graphUrl' | 'graphVersion'>): string {
  return config.graphUrl.replace(/\/$/, '') + '/' + encodeURIComponent(config.graphVersion)
}

async function postMessage (
  config: Pick<Config, 'graphUrl' | 'graphVersion'>,
  token: string,
  phoneNumberId: string,
  body: Record<string, unknown>,
  request: typeof fetch
): Promise<string> {
  try {
    const response = await request(graphBase(config) + '/' + phoneNumberId + '/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...body }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error'
    })
    const data = await response.json()
    if (!response.ok) throw graphError(String(data.error?.code ?? response.status))
    const id = data.messages?.[0]?.id
    if (typeof id !== 'string' || id === '') throw new Error('Missing message ID')
    return id
  } catch (err) {
    if (err instanceof SendError) throw err
    // A timeout can occur after the provider accepted the message. Do not auto-resend.
    throw new SendError('DELIVERY_UNKNOWN', '无法确认发送结果，请先核实客户是否收到，再决定是否重新发送。')
  }
}

export async function sendText (
  config: Pick<Config, 'graphUrl' | 'graphVersion'>,
  token: string,
  phoneNumberId: string,
  to: string,
  content: string,
  request: typeof fetch = fetch
): Promise<string> {
  return await postMessage(config, token, phoneNumberId, { to, type: 'text', text: { body: content } }, request)
}

export async function sendTemplate (
  config: Pick<Config, 'graphUrl' | 'graphVersion'>,
  token: string,
  phoneNumberId: string,
  to: string,
  template: TemplateMessage,
  request: typeof fetch = fetch
): Promise<string> {
  const components =
    template.parameters.length > 0
      ? [{ type: 'body', parameters: template.parameters.map((text) => ({ type: 'text', text })) }]
      : undefined
  return await postMessage(
    config,
    token,
    phoneNumberId,
    {
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(components !== undefined ? { components } : {})
      }
    },
    request
  )
}

/**
 * A template is offered only when Huly can fill it: approved, positional body
 * variables, and no header / button variables or media headers.
 */
export function toSendableTemplate (raw: any): WhatsappTemplate | undefined {
  if (raw?.status !== 'APPROVED' || typeof raw.name !== 'string' || typeof raw.language !== 'string') return undefined
  if (!/^[a-z0-9_]{1,512}$/.test(raw.name) || !/^[A-Za-z_]{2,15}$/.test(raw.language)) return undefined
  const components: any[] = Array.isArray(raw.components) ? raw.components : []
  let body = ''
  for (const component of components) {
    const type = String(component?.type ?? '').toUpperCase()
    if (type === 'BODY') {
      body = typeof component.text === 'string' ? component.text : ''
    } else if (type === 'HEADER') {
      if (component.format !== undefined && component.format !== 'TEXT') return undefined
      if (typeof component.text === 'string' && (component.text as string).includes('{{')) return undefined
    } else if (type === 'BUTTONS') {
      if (JSON.stringify(component.buttons ?? []).includes('{{')) return undefined
    } else if (type !== 'FOOTER') {
      return undefined
    }
  }
  const parameterCount = templateParameterCount(body)
  if (body === '' || parameterCount < 0) return undefined
  return { name: raw.name, language: raw.language, body, parameterCount }
}

export async function listTemplates (
  config: Pick<Config, 'graphUrl' | 'graphVersion'>,
  token: string,
  wabaId: string,
  request: typeof fetch = fetch
): Promise<WhatsappTemplate[]> {
  let data: any
  try {
    const response = await request(
      graphBase(config) +
        '/' +
        wabaId +
        '/message_templates?status=APPROVED&limit=200&fields=name,language,status,components',
      {
        headers: { Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(15000),
        redirect: 'error'
      }
    )
    data = await response.json()
    if (!response.ok) throw graphError(String(data.error?.code ?? response.status))
  } catch (err) {
    if (err instanceof SendError) throw err
    throw new SendError('SERVICE_UNAVAILABLE', '读取模板失败，请稍后再试。')
  }
  const list: any[] = Array.isArray(data?.data) ? data.data : []
  return list
    .map(toSendableTemplate)
    .filter((t): t is WhatsappTemplate => t !== undefined)
    .sort((a, b) => (a.name !== b.name ? a.name.localeCompare(b.name) : a.language.localeCompare(b.language)))
}
