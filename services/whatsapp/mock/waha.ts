// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHmac, randomUUID } from 'node:crypto'

interface Session {
  name: string
  status: string
  me?: { id: string }
  config: { webhooks: Array<{ url: string, hmac: { key: string } }> }
}
const sessions = new Map<string, Session>()
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW6kAAAAASUVORK5CYII=', 'base64')
const key = process.env.WHATSAPP_WAHA_API_KEY
const secret = process.env.WHATSAPP_WAHA_WEBHOOK_SECRET
if (!key || !secret) throw new Error('Local WAHA simulator requires credentials from the environment')

function json (res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data))
}
async function read (req: IncomingMessage): Promise<Record<string, any>> {
  let value = ''
  for await (const chunk of req) {
    value += String(chunk)
    if (value.length > 1024 * 1024) throw new Error('Body too large')
  }
  return JSON.parse(value || '{}')
}
async function push (session: Session, event: string, payload: unknown): Promise<void> {
  const body = JSON.stringify({ id: randomUUID(), timestamp: Date.now(), session: session.name, event, payload })
  for (const hook of session.config.webhooks) {
    const url = new URL(hook.url)
    if (!['127.0.0.1', 'localhost', 'huly.local', 'whatsapp', 'host.docker.internal'].includes(url.hostname) ||
      !['http:', 'https:'].includes(url.protocol)) throw new Error('Local webhook only')
    const response = await fetch(url, { method: 'POST', redirect: 'error', headers: {
      'Content-Type': 'application/json', 'X-Webhook-Timestamp': String(Date.now()),
      'X-Webhook-Request-Id': randomUUID(), 'X-Webhook-Hmac-Algorithm': 'sha512', 'X-Webhook-Hmac': createHmac('sha512', secret).update(body).digest('hex')
    }, body })
    if (!response.ok) throw new Error('Local callback failed')
  }
}
async function handle (req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.headers['x-api-key'] !== key) { json(res, 401, {}); return }
  const path = (req.url ?? '').split('?')[0]
  const parts = path.split('/')
  const method = req.method
  if (path === '/api/sessions' && method === 'GET') {
    json(res, 200, [...sessions.values()].map(({ name, status }) => ({ name, status })))
    return
  }
  if (path === '/api/sessions' && method === 'POST') {
    const body = await read(req) as unknown as Session
    if (process.env.MOCK_WAHA_CORE === '1' && body.name !== 'default') {
      json(res, 422, { message: 'WAHA Core supports only the default session' }); return
    }
    if (sessions.has(body.name)) { json(res, 409, {}); return }
    const session = { ...body, status: 'SCAN_QR_CODE' }
    sessions.set(body.name, session)
    json(res, 201, { name: session.name, status: session.status }); return
  }
  if (path === '/api/sendText' && method === 'POST') {
    const body = await read(req)
    const session = sessions.get(body.session)
    if (session?.status !== 'WORKING') { json(res, 422, {}); return }
    const id = 'fake-' + randomUUID()
    json(res, 201, { id })
    void push(session, 'message.any', {
      id, fromMe: true, to: body.chatId, body: body.text, timestamp: Math.floor(Date.now() / 1000)
    }).catch(() => {})
    return
  }
  let session: Session | undefined
  if (parts[1] === 'api' && parts[2] === 'sessions') session = sessions.get(parts[3])
  else if (parts[1] === 'api' && parts[3] === 'auth' && parts[4] === 'qr') session = sessions.get(parts[2])
  else if (parts[1] === 'control') session = sessions.get(parts[2])
  if (session === undefined) { json(res, 404, {}); return }
  if (parts[1] === 'control' && method === 'POST') {
    const body = await read(req)
    if (parts[3] === 'scan') {
      const phone = String(body.phone ?? '15550100001')
      if (!/^155501\d{5}$/.test(phone)) { json(res, 400, {}); return }
      session.me = { id: phone + '@c.us' }
      session.status = 'WORKING'
      await push(session, 'session.status', { status: session.status })
    } else if (parts[3] === 'status') {
      session.status = String(body.status)
      await push(session, 'session.status', { status: session.status })
    } else if (parts[3] === 'event') {
      await push(session, String(body.event), body.payload)
    } else { json(res, 404, {}); return }
    json(res, 200, {}); return
  }
  if (parts[4] === 'qr' && method === 'GET') {
    if (session.status !== 'SCAN_QR_CODE') { json(res, 409, {}); return }
    res.writeHead(200, { 'Content-Type': 'image/png' }).end(png); return
  }
  if (method === 'DELETE') sessions.delete(session.name)
  if (method === 'POST') {
    session.status = parts[4] === 'logout' ? 'STOPPED' : 'SCAN_QR_CODE'
    if (parts[4] === 'logout') delete session.me
  }
  json(res, 200, { name: session.name, status: session.status, me: session.me })
}

createServer((req, res) => {
  void handle(req, res).catch(() => json(res, 500, {}))
}).listen(Number(process.env.MOCK_WAHA_PORT ?? 8096), process.env.MOCK_WAHA_BIND ?? '127.0.0.1')
