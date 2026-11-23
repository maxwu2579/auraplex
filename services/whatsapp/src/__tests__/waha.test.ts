// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { createHmac, randomBytes } from 'crypto'
import { parseWahaEvent, sessionName, verifyWahaSignature, WahaClient } from '../waha'

test('WAHA HMAC authenticates the exact bytes and refuses an unset secret', () => {
  const raw = Buffer.from('{"event":"message"}')
  const secret = randomBytes(32).toString('hex')
  const signature = createHmac('sha512', secret).update(raw).digest('hex')
  expect(verifyWahaSignature(raw, signature, secret)).toBe(true)
  expect(verifyWahaSignature(Buffer.from('changed'), signature, secret)).toBe(false)
  expect(verifyWahaSignature(raw, signature, '')).toBe(false)
})

test('WAHA maps only direct conversations and preserves outbound phone messages', () => {
  const payload = { id: 'fake', timestamp: 1, fromMe: true, from: '15550100001@c.us', body: 'test' }
  for (const to of ['status@broadcast', '1@g.us', '1@newsletter']) {
    expect(parseWahaEvent('message.any', 'session', '15550100001', { ...payload, to }).messages).toEqual([])
  }
  expect(parseWahaEvent('message.any', 'session', '15550100001', { ...payload, to: '15550100002@c.us' }).messages)
    .toMatchObject([{ outgoing: true, phone: '15550100002', wamid: 'fake' }])
  expect(sessionName('test', 'owner')).toMatch(/^huly-[a-f0-9]{32}$/)
  expect(sessionName('test', 'owner')).not.toBe(sessionName('test', 'other'))
})

test('a single-session Core response maps to a stable application error', async () => {
  const client = new WahaClient({
    port: 0, accountsUrl: '', secret: '', publicUrl: 'http://localhost',
    allowedOrigins: [], graphUrl: '', graphVersion: '', wahaUrl: 'http://localhost',
    wahaApiKey: randomBytes(32).toString('hex')
  }, jest.fn().mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockResolvedValueOnce(new Response('WAHA Core supports only the default session', { status: 422 })))
  await expect(client.start(sessionName('fake', 'fake'))).rejects.toThrow('SingleSession')
})
