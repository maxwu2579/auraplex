// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { AuthenticationExtension } from './authentication'
import { checkCollaborationAccess } from '../departmentAccess'

jest.mock('../config', () => ({ __esModule: true, default: { AccountsUrl: 'http://account.test' } }))
jest.mock('../utils', () => ({ getWorkspaceIds: jest.fn(async () => ({ uuid: 'workspace' })) }))
jest.mock('../departmentAccess', () => ({ checkCollaborationAccess: jest.fn() }))
jest.mock('@hcengineering/server-token', () => ({
  decodeToken: jest.fn(() => ({ account: 'user', workspace: 'workspace', extra: {} }))
}))
jest.mock('@hcengineering/account', () => ({ isReadOnlyOrGuest: jest.fn(() => false) }))

const check = checkCollaborationAccess as jest.MockedFunction<typeof checkCollaborationAccess>
const ctx = { with: async (_name: string, _params: unknown, fn: () => Promise<unknown>) => await fn(), info: jest.fn() }
const authData = (): any => ({
  token: 'fake',
  documentName: 'workspace|class|id|body',
  connection: { readOnly: false },
  context: {},
  requestParameters: new URLSearchParams()
})

beforeEach(() => {
  check.mockReset()
})
test('rejects a connection without read access', async () => {
  check.mockResolvedValue({ read: false, write: false })
  await expect(new AuthenticationExtension({ ctx: ctx as any }).onAuthenticate(authData())).rejects.toThrow(
    'Document access denied'
  )
})
test('marks an allowed reader as readonly', async () => {
  check.mockResolvedValue({ read: true, write: false })
  const data = authData()
  await new AuthenticationExtension({ ctx: ctx as any }).onAuthenticate(data)
  expect(data.connection.readOnly).toBe(true)
})
test('disconnects an idle connection after a permission change', async () => {
  jest.useFakeTimers()
  try {
    check.mockResolvedValue({ read: true, write: false })
    const close = jest.fn()
    const extension = new AuthenticationExtension({ ctx: ctx as any })
    await extension.connected({
      context: { authToken: 'fake' },
      documentName: 'workspace|class|id|body',
      socketId: 'socket',
      connectionInstance: { readOnly: false, close }
    } as any)
    await jest.advanceTimersByTimeAsync(3000)
    expect(close).toHaveBeenCalled()
    await extension.onDisconnect({ socketId: 'socket', documentName: 'workspace|class|id|body' } as any)
    expect(jest.getTimerCount()).toBe(0)
  } finally {
    jest.useRealTimers()
  }
})

test('keeps separate permission checks for multiple documents on one socket', async () => {
  jest.useFakeTimers()
  try {
    check.mockResolvedValue({ read: true, write: true })
    const extension = new AuthenticationExtension({ ctx: ctx as any })
    const data: any = {
      context: { authToken: 'fake' },
      documentName: 'workspace|class|one|body',
      socketId: 'socket',
      connectionInstance: { readOnly: false, close: jest.fn() }
    }
    await extension.connected(data)
    await extension.connected({ ...data, documentName: 'workspace|class|two|body' })
    expect(jest.getTimerCount()).toBe(2)
    await extension.onDisconnect({ socketId: 'socket', documentName: data.documentName } as any)
    expect(jest.getTimerCount()).toBe(1)
    await extension.onDisconnect({ socketId: 'socket', documentName: 'workspace|class|two|body' } as any)
    expect(jest.getTimerCount()).toBe(0)
  } finally {
    jest.useRealTimers()
  }
})
