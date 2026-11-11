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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createHmac, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

test('local simulator supports templates, errors, signed status callbacks and incoming CLI messages', { timeout: 15000 }, async () => {
  const secret = randomBytes(32).toString('hex')
  const token = randomBytes(24).toString('hex')
  const received = []
  let notify
  const statusesDone = new Promise(resolve => { notify = resolve })
  const webhook = createServer(async (req, res) => {
    const buffers = []
    for await (const buffer of req) buffers.push(buffer)
    const raw = Buffer.concat(buffers)
    assert.equal(req.headers['x-hub-signature-256'], 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'))
    received.push(JSON.parse(raw))
    res.end('ok')
    if (received.filter(event => event.entry[0].changes[0].value.statuses).length === 2) notify()
  })
  webhook.listen(0, '127.0.0.1')
  await once(webhook, 'listening')
  const address = 'http://127.0.0.1:' + webhook.address().port + '/webhook'
  const env = { ...process.env, WHATSAPP_APP_SECRET: secret, WHATSAPP_MOCK_TOKEN: token }
  const script = fileURLToPath(new URL('./index.mjs', import.meta.url))
  const child = spawn(process.execPath, [script, 'start', '--port', '0', '--webhook', address], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const port = await new Promise((resolve, reject) => {
      let output = ''
      child.stdout.on('data', buffer => { output += buffer.toString(); const match = output.match(/端口 (\d+)/); if (match) resolve(match[1]) })
      child.on('exit', () => reject(new Error('Mock server exited before startup')))
    })
    const base = 'http://127.0.0.1:' + port
    const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    const templates = await (await fetch(base + '/mock/200001/message_templates', { headers })).json()
    assert.equal(templates.data.filter(template => template.status === 'APPROVED').length, 2)
    assert.equal((await fetch(base + '/mock/200001/message_templates')).status, 401)
    const sent = await (await fetch(base + '/mock/100001/messages', { method: 'POST', headers, body: JSON.stringify({ to: '6588880001', type: 'text', text: { body: 'test' } }) })).json()
    assert.ok(sent.messages[0].id.startsWith('wamid.mock.'))
    const replies = await (await fetch(base + '/control/messages')).json()
    assert.equal(replies.messages[0].text, 'test')
    assert.equal(replies.messages[0].to, '6588880001')
    await statusesDone
    assert.deepEqual(received.map(event => event.entry[0].changes[0].value.statuses[0].status), ['delivered', 'read'])
    await fetch(base + '/control/error', { method: 'POST', headers, body: JSON.stringify({ mode: 'window' }) })
    const failed = await (await fetch(base + '/mock/100001/messages', { method: 'POST', headers, body: JSON.stringify({ type: 'text' }) })).json()
    assert.equal(failed.error.code, 131047)
    await fetch(base + '/control/error', { method: 'POST', headers, body: JSON.stringify({ mode: 'token' }) })
    assert.equal((await fetch(base + '/mock/200001/message_templates', { headers })).status, 401)
    const sender = spawn(process.execPath, [script, 'send', '--webhook', address, '--phone', '+65 (8888) 0001', '--name', '测试客户', '--text', '本地消息', '--id', 'wamid.cli', '--repeat', '2'], { env, stdio: 'ignore' })
    const [code] = await once(sender, 'exit')
    assert.equal(code, 0)
    assert.equal(received.filter(event => event.entry[0].changes[0].value.messages?.[0]?.id === 'wamid.cli').length, 2)
  } finally {
    child.kill()
    await new Promise(resolve => webhook.close(resolve))
  }
})
