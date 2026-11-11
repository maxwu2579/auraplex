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
  if (code === '130429' || code === '131048') return new SendError(code, '发送过于频繁，请稍后再试。')
  return new SendError(code, '消息发送失败，请检查账号配置或稍后重试。')
}

export async function sendText (
  config: Pick<Config, 'graphUrl' | 'graphVersion'>,
  token: string,
  phoneNumberId: string,
  to: string,
  content: string,
  request: typeof fetch = fetch
): Promise<string> {
  try {
    const response = await request(
      config.graphUrl.replace(/\/$/, '') +
        '/' +
        encodeURIComponent(config.graphVersion) +
        '/' +
        phoneNumberId +
        '/messages',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body: content }
        }),
        signal: AbortSignal.timeout(15000),
        redirect: 'error'
      }
    )
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
