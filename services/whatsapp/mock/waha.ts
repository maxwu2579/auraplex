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
const keys = new Map<string, { id: string, key: string, session: string }>()
const history = new Map<string, Array<Record<string, any>>>()
const files = new Map<string, { session: string, bytes: Buffer, type: string }>()
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW6kAAAAASUVORK5CYII=', 'base64')
function requiredEnv (name: string): string {
  const value = process.env[name]
  if (!value) throw new Error('Local WAHA simulator requires credentials from the environment')
  return value
}
const key = requiredEnv('WHATSAPP_WAHA_API_KEY')
const secret = requiredEnv('WHATSAPP_WAHA_WEBHOOK_SECRET')

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
  const supplied = req.headers['x-api-key']
  const scoped = [...keys.values()].find((value) => value.key === supplied)
  if (supplied !== key && scoped === undefined) { json(res, 401, {}); return }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const parts = path.split('/')
  const method = req.method
  if (path === '/api/server/version' && method === 'GET' && supplied === key) {
    json(res, 200, { version: 'mock', engine: 'WEBJS' }); return
  }
  if (path === '/api/keys' && method === 'POST' && supplied === key) {
    const body = await read(req)
    if (!sessions.has(body.session) || body.isAdmin !== false || body.actions?.control !== false ||
      body.actions?.setting !== false || body.actions?.delete !== false) { json(res, 422, {}); return }
    const created = { id: randomUUID(), key: randomUUID(), session: body.session }
    keys.set(created.id, created)
    json(res, 201, created); return
  }
  if (parts[1] === 'api' && parts[2] === 'keys' && method === 'DELETE' && supplied === key) {
    json(res, keys.delete(parts[3]) ? 200 : 404, {}); return
  }
  if (parts[1] === 'api' && parts[2] === 'files' && method === 'GET') {
    const stored = files.get(parts[3])
    if (stored === undefined || (scoped !== undefined && stored.session !== scoped.session)) { json(res, 404, {}); return }
    res.writeHead(200, { 'Content-Type': stored.type }).end(stored.bytes); return
  }
  if (parts[1] === 'api' && (parts[3] === 'lids' || parts[3] === 'chats') && method === 'GET') {
    const session = parts[2]
    if (!sessions.has(session) || (scoped !== undefined && scoped.session !== session)) { json(res, 403, {}); return }
    if (parts[3] === 'lids') { json(res, 200, { lid: decodeURIComponent(parts[4]), pn: null }); return }
    const rows = history.get(session) ?? []
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = Number(url.searchParams.get('limit') ?? 50)
    if (parts[4] === undefined) {
      const chats = [...new Set(rows.map((row) => row.chatId))].map((id) => ({ id }))
      json(res, 200, chats.slice(offset, offset + limit)); return
    }
    const chat = decodeURIComponent(parts[4])
    const messages = rows.filter((row) => row.chatId === chat)
    if (parts[6] !== undefined) {
      const message = messages.find((row) => row.id === decodeURIComponent(parts[6]))
      json(res, message === undefined ? 404 : 200, message ?? {}); return
    }
    const after = Number(url.searchParams.get('filter.timestamp.gte') ?? 0)
    const before = Number(url.searchParams.get('filter.timestamp.lte') ?? Number.MAX_SAFE_INTEGER)
    json(res, 200, messages.filter((row) => row.timestamp >= after && row.timestamp <= before).slice(offset, offset + limit))
    return
  }
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
  if (['/api/sendText', '/api/sendImage', '/api/sendVideo', '/api/sendVoice', '/api/sendFile'].includes(path) && method === 'POST') {
    const body = await read(req)
    const session = sessions.get(body.session)
    if (scoped !== undefined && scoped.session !== body.session) { json(res, 403, {}); return }
    if (session?.status !== 'WORKING') { json(res, 422, {}); return }
    const id = 'fake-' + randomUUID()
    json(res, 201, { id })
    const payload = { id, fromMe: true, to: body.chatId, chatId: body.chatId,
      body: body.text ?? body.caption, timestamp: Math.floor(Date.now() / 1000) } as Record<string, any>
    if (typeof body.file?.data === 'string') {
      const file = randomUUID()
      files.set(file, { session: session.name, bytes: Buffer.from(body.file.data, 'base64'), type: body.file.mimetype })
      payload.hasMedia = true
      payload.media = { url: 'http://' + req.headers.host + '/api/files/' + file, mimetype: body.file.mimetype, filename: body.file.filename }
    }
    history.set(session.name, [...(history.get(session.name) ?? []), payload])
    void push(session, 'message.any', payload).catch(() => {})
    return
  }
  if (scoped !== undefined) { json(res, 403, {}); return }
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
      if (body.event === 'message.any' && body.payload != null) {
        const payload = { ...body.payload, chatId: body.payload.chatId ?? (body.payload.fromMe ? body.payload.to : body.payload.from) }
        history.set(session.name, [...(history.get(session.name) ?? []), payload])
      }
      await push(session, String(body.event), body.payload)
    } else { json(res, 404, {}); return }
    json(res, 200, {}); return
  }
  if (parts[4] === 'qr' && method === 'GET') {
    if (session.status !== 'SCAN_QR_CODE') { json(res, 409, {}); return }
    res.writeHead(200, { 'Content-Type': 'image/png' }).end(png); return
  }
  if (method === 'PUT') session.config = (await read(req)).config
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
