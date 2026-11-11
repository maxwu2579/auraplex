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

import { createServer } from 'node:http'
import { createHmac, randomUUID, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

// This tool is mounted only by compose.mock.yaml and is excluded from the service image.
try {
  for (const line of readFileSync(new URL('../../../dev/.env.whatsapp.local', import.meta.url), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^(WHATSAPP_[A-Z_]+)=(.*)$/)
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2]
  }
} catch { /* Docker supplies the same settings via env_file. */ }

const [command = 'start', ...args] = process.argv.slice(2)
const options = {}
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith('--')) throw new Error('参数需要以 -- 开头')
  const key = args[i].slice(2)
  options[key] = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : true
}

function localUrl (value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '::1', '[::1]', 'huly.local', 'whatsapp', 'host.docker.internal'].includes(url.hostname)) {
    throw new Error('模拟器只允许连接本机或本地 Docker 服务')
  }
  return url
}
if (command === 'setup') {
  const file = new URL('../../../dev/.env.whatsapp.local', import.meta.url)
  if (!existsSync(file)) {
    if (typeof options.token !== 'string' || options.token.trim() === '' || /[\r\n]/.test(options.token)) throw new Error('需要 --token 本地测试令牌')
    writeFileSync(file, '# 只用于本地模拟测试，不能用于真实账号\nWHATSAPP_APP_SECRET=' + randomBytes(32).toString('hex') + '\nWHATSAPP_VERIFY_TOKEN=' + randomBytes(24).toString('hex') + '\nWHATSAPP_MOCK_TOKEN=' + options.token + '\n', { flag: 'wx', mode: 0o600 })
    console.log('已生成本地模拟配置')
  } else console.log('本地模拟配置已存在，保留现有配置')
  process.exit(0)
}
const webhook = localUrl(String(options.webhook ?? 'http://127.0.0.1:8098/webhook'))
const secret = process.env.WHATSAPP_APP_SECRET
if (!secret) throw new Error('请先按 README 配置 dev/.env.whatsapp.local')
const phoneNumberId = String(options['phone-number-id'] ?? '100001')

function payload (value) {
  return { object: 'whatsapp_business_account', entry: [{ id: String(options['waba-id'] ?? '200001'), changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, ...value } }] }] }
}
async function push (data, badSignature = false) {
  const body = JSON.stringify(data)
  const signature = badSignature ? '0'.repeat(64) : createHmac('sha256', secret).update(body).digest('hex')
  const response = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + signature }, body })
  if (!response.ok) throw new Error('本地回调返回 HTTP ' + response.status)
}
function json (res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
async function body (req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new Error('请求过大')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

async function main () {
  if (command === 'send') {
    const phone = String(options.phone ?? '').replace(/[^0-9]/g, '')
    if (!phone || typeof options.text !== 'string') throw new Error('需要 --phone 号码 --name 昵称 --text 文字')
    const id = String(options.id ?? 'wamid.mock.' + randomUUID())
    const type = String(options.type ?? 'text')
    const data = payload({ contacts: [{ wa_id: phone, profile: { name: String(options.name ?? phone) } }],
      messages: [{ id, from: phone, timestamp: String(options.timestamp ?? Math.floor(Date.now() / 1000)), type,
        ...(type === 'text' ? { text: { body: options.text } } : {}) }] })
    for (let i = 0; i < Number(options.repeat ?? 1); i++) await push(data, options['bad-signature'] === true)
    console.log('已提交本地模拟消息，稍等几秒后到 Huly 查看。消息编号 ' + id)
    return
  }
  if (command === 'error') {
    const mode = String(options.mode ?? 'none')
    const target = localUrl(String(options.url ?? 'http://127.0.0.1:8097/control/error'))
    const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) })
    if (!response.ok) throw new Error('切换错误模式失败')
    console.log('模拟错误模式已切换为 ' + mode)
    return
  }
  if (command !== 'start') throw new Error('命令应为 start、send 或 error')
  const expectedToken = process.env.WHATSAPP_MOCK_TOKEN
  if (!expectedToken) throw new Error('请设置本地测试用 WHATSAPP_MOCK_TOKEN')
  let errorMode = 'none'
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/health') { json(res, 200, { status: 'ok', mode: errorMode }); return }
      if (url.pathname === '/control/error' && req.method === 'POST') {
        const data = await body(req)
        if (!['none', 'token', 'window'].includes(data.mode)) { json(res, 400, { error: '未知模式' }); return }
        errorMode = data.mode
        json(res, 200, { mode: errorMode }); return
      }
      if (req.headers.authorization !== 'Bearer ' + expectedToken || errorMode === 'token') {
        json(res, 401, { error: { code: 190, message: '模拟令牌无效' } }); return
      }
      if (url.pathname.endsWith('/message_templates') && req.method === 'GET') {
        json(res, 200, { data: [
          { name: 'product_followup_zh', language: 'zh_CN', status: 'APPROVED', components: [{ type: 'BODY', text: '您好 {{1}}，您咨询的产品 {{2}} 已有新资料。' }] },
          { name: 'product_followup_en', language: 'en_US', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hello {{1}}, we have an update on {{2}}.' }] },
          { name: 'draft_example', language: 'en_US', status: 'PENDING', components: [] }
        ] }); return
      }
      if (url.pathname.endsWith('/messages') && req.method === 'POST') {
        const request = await body(req)
        if (errorMode === 'window' && request.type !== 'template') {
          json(res, 400, { error: { code: 131047, message: '模拟超过 24 小时窗口' } }); return
        }
        const id = 'wamid.mock.' + randomUUID()
        json(res, 200, { messaging_product: 'whatsapp', messages: [{ id }] })
        for (const [index, status] of ['delivered', 'read'].entries()) {
          setTimeout(() => { void push(payload({ statuses: [{ id, status, recipient_id: request.to, timestamp: String(Math.floor(Date.now() / 1000)) }] })).catch(() => console.error('本地消息状态推送失败')) }, (index + 1) * 1500)
        }
        console.log('模拟接口已接收发送请求，消息编号 ' + id)
        return
      }
      json(res, 404, { error: '未找到模拟接口' })
    })().catch(() => json(res, 400, { error: '模拟请求无效' }))
  })
  server.listen(Number(options.port ?? 8097), String(options.bind ?? '127.0.0.1'), () => console.log('本地 Graph 模拟器已启动，端口 ' + server.address().port))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
