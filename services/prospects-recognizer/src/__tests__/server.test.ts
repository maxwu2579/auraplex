import { createApp } from '../server'
import type { Server } from 'http'
jest.mock('@hcengineering/account-client', () => ({
  getClient: (_url: string, token: string) => ({
    getLoginInfoByToken: async () => {
      if (token === 'invalid') throw new Error('invalid')
      return { workspace: 'test', account: 'test', role: token === 'guest' ? 'GUEST' : 'USER' }
    },
    getWorkspaceMembers: async () => (token === 'outsider' ? [] : [{ person: 'test', role: 'USER' }])
  }),
  isWorkspaceLoginInfo: () => true
}))
let server: Server
let base: string
let request: jest.Mock
beforeEach(async () => {
  request = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: 'Test Person',
                  email: 'bad@@example',
                  phone: '+65 12345678',
                  ignored: 'x'
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
  )
  server = createApp(
    { accountsUrl: 'http://test', aiUrl: 'http://fake', model: 'fake-model' },
    request as unknown as typeof fetch
  ).listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing address')
  base = `http://127.0.0.1:${address.port}`
})
test('reports malformed model replies and limits the number of photos', async () => {
  request.mockResolvedValueOnce(new Response('{invalid json', { status: 200 }))
  const call = async (images: string[]): Promise<Response> =>
    await fetch(`${base}/api/recognize`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ images })
    })
  const invalid = await call(['data:image/jpeg;base64,YQ=='])
  expect(invalid.status).toBe(502)
  expect((await invalid.json()).error).toBe('返回格式不对')
  const tooMany = await call([
    'data:image/jpeg;base64,YQ==',
    'data:image/jpeg;base64,YQ==',
    'data:image/jpeg;base64,YQ=='
  ])
  expect(tooMany.status).toBe(400)
})
test('reports an AI timeout without exposing the error detail', async () => {
  const error = new Error('private upstream detail')
  error.name = 'AbortError'
  request.mockRejectedValueOnce(error)
  const res = await fetch(`${base}/api/recognize`, {
    method: 'POST',
    headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
    body: JSON.stringify({ images: ['data:image/jpeg;base64,YQ=='] })
  })
  expect(res.status).toBe(502)
  expect((await res.json()).error).toBe('识别超时')
})
test('logs only a job id, elapsed time and category', async () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {})
  try {
    await fetch(`${base}/api/recognize`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ images: ['data:image/jpeg;base64,YQ=='] })
    })
    expect(spy).toHaveBeenCalledTimes(1)
    const entry = JSON.parse(String(spy.mock.calls[0][0]))
    expect(Object.keys(entry).sort()).toEqual(['elapsedMs', 'job', 'type'])
  } finally {
    spy.mockRestore()
  }
})
test('returns unconfigured status without an AI endpoint', async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve()
    })
  )
  server = createApp({ accountsUrl: 'http://test' }).listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing address')
  const result = await fetch(`http://127.0.0.1:${address.port}/api/status`, {
    headers: { authorization: 'Bearer test' }
  })
  expect((await result.json()).configured).toBe(false)
})
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => {
      if (err !== undefined) reject(err)
      else resolve()
    })
  )
})
test('rejects missing credentials and validates AI output', async () => {
  expect((await fetch(`${base}/api/status`)).status).toBe(401)
  expect((await fetch(`${base}/api/status`, { headers: { authorization: 'Bearer invalid' } })).status).toBe(401)
  expect((await fetch(`${base}/api/status`, { headers: { authorization: 'Bearer guest' } })).status).toBe(403)
  expect((await fetch(`${base}/api/status`, { headers: { authorization: 'Bearer outsider' } })).status).toBe(403)
  const res = await fetch(`${base}/api/recognize`, {
    method: 'POST',
    headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
    body: JSON.stringify({ images: ['data:image/jpeg;base64,YQ=='] })
  })
  expect(res.status).toBe(200)
  const result = await res.json()
  expect(result.values.name).toBe('Test Person')
  expect(result.values.email).toBe('')
  expect(result.needsReview).toContain('email')
  expect(result.values.ignored).toBeUndefined()
})

async function recognizeWithFields (fields: unknown): Promise<Response> {
  return await fetch(base + '/api/recognize', {
    method: 'POST',
    headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
    body: JSON.stringify({ images: ['data:image/jpeg;base64,YQ=='], fields })
  })
}

test.each([
  Array.from({ length: 41 }, (_, index) => ({ key: 'c_' + index, label: 'Sample', type: 'text' })),
  [{ key: 'name', label: 'X'.repeat(81), type: 'text' }],
  [{ key: 'c_color', label: 'Color', type: 'select', options: [] }],
  [{ key: 'unknown', label: 'Unknown', type: 'text' }],
  [{ key: 'name', label: 'Name', type: 'text' }, { key: 'name', label: 'Duplicate', type: 'text' }]
])('rejects invalid template fields before contacting the model %#', async (...fields) => {
  expect((await recognizeWithFields(fields)).status).toBe(400)
  expect(request).not.toHaveBeenCalled()
})

test('requests only the submitted fields and discards unlisted keys and invalid values', async () => {
  const fields = [
    { key: 'name', label: 'Contact name', type: 'text' },
    { key: 'c_meeting', label: 'Meeting date', type: 'date' },
    { key: 'c_due', label: 'Follow-up', type: 'date' },
    { key: 'c_city', label: 'City', type: 'select', options: ['Example City'] },
    { key: 'c_category', label: 'Category', type: 'select', options: ['Allowed'] }
  ]
  const content = JSON.stringify({
    name: 'Test Person', c_meeting: '2026-11-27', c_due: '2026-02-29',
    c_city: 'Example City', c_category: 'Invented', email: 'hidden@example.test', unforeseen: 'not requested'
  })
  request.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content } }] })))
  const res = await recognizeWithFields(fields)
  expect(res.status).toBe(200)
  const result = await res.json()
  expect(result.values).toEqual({ name: 'Test Person', c_meeting: '2026-11-27', c_due: '', c_city: 'Example City', c_category: '' })
  expect(result.needsReview).toEqual(['c_due', 'c_category'])
  const sent = JSON.parse(request.mock.calls[0][1].body)
  const prompt = sent.messages[0].content[0].text
  expect(prompt).toContain(JSON.stringify(fields))
  expect(prompt).toContain('YYYY-MM-DD')
})
