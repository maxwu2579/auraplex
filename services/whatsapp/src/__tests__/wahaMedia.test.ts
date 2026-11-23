// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { randomBytes } from 'crypto'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { WahaMedia } from '../wahaMedia'

test('WAHA media is downloaded only from the configured origin and scoped to the owner session', async () => {
  const inboxDirectory = await mkdtemp(join(tmpdir(), 'waha-media-test-'))
  const key = randomBytes(32).toString('hex')
  const request = jest.fn(async () => new Response('synthetic-media'))
  const media = new WahaMedia({
    port: 0, accountsUrl: '', secret: '', publicUrl: 'http://localhost', allowedOrigins: [],
    graphUrl: '', graphVersion: '', wahaUrl: 'http://127.0.0.1:8099', wahaApiKey: key, inboxDirectory
  }, request)
  try {
    expect(await media.save('first', 'msg', { url: 'http://127.0.0.1:9999/api/files/a' })).toBe(false)
    expect(request).not.toHaveBeenCalled()
    expect(await media.save('first', 'msg', { url: '/api/files/a' })).toBe(true)
    expect(String(await media.read('first', 'msg'))).toBe('synthetic-media')
    expect(await media.read('second', 'msg')).toBeUndefined()
  } finally {
    await rm(inboxDirectory, { recursive: true, force: true })
  }
})
