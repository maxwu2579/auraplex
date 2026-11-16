import { createApp } from '../server'
import type { Server } from 'http'
jest.mock('@hcengineering/account-client', () => ({
  getClient: () => ({
    getLoginInfoByToken: async () => ({ workspace: 'test', account: 'test', role: 'USER' }),
    getWorkspaceMembers: async () => [{ person: 'test', role: 'USER' }]
  }),
  isWorkspaceLoginInfo: () => true
}))
// The standalone simulator and the backend exchange an actual HTTP request.
const fake: Server = require('../../mock/index.cjs') // eslint-disable-line @typescript-eslint/no-var-requires
function port (server: Server): number {
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('missing port')
  return addr.port
}
test('sends a pair of fake images through the local OpenAI-compatible simulator', async () => {
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
  const api = createApp({
    accountsUrl: 'http://test',
    aiUrl: `http://127.0.0.1:${port(fake)}`,
    model: 'fake-model'
  }).listen(0)
  await new Promise<void>((resolve) => api.once('listening', resolve))
  try {
    const res = await fetch(`http://127.0.0.1:${port(api)}/api/recognize`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ images: ['data:image/jpeg;base64,YQ==', 'data:image/jpeg;base64,Yg=='] })
    })
    const result = await res.json()
    expect(res.status).toBe(200)
    expect(result.values.name).toBe('TEST PERSON')
    expect(result.model).toBe('fake-model')
  } finally {
    await new Promise<void>((resolve) =>
      api.close(() => {
        resolve()
      })
    )
    await new Promise<void>((resolve) =>
      fake.close(() => {
        resolve()
      })
    )
  }
})
