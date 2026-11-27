// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AddressInfo } from 'node:net'
import { getClient, isWorkspaceLoginInfo } from '@hcengineering/account-client'
import { AccountRole, type WorkspaceUuid } from '@hcengineering/core'
import { createApp, type TaskMailBackend } from '../server'
import { defaultDigest } from '../taskDigest'

jest.mock('@hcengineering/account-client')

const workspace = 'fake-workspace' as WorkspaceUuid
const actor = 'fake-actor'
const getLoginInfoByToken = jest.fn()
const getWorkspaceMembers = jest.fn()
const taskMail: jest.Mocked<TaskMailBackend> = {
  get: jest.fn(), save: jest.fn(), test: jest.fn()
}
const mail = { send: jest.fn(), forward: jest.fn() }

beforeEach(() => {
  jest.resetAllMocks()
  jest.mocked(isWorkspaceLoginInfo).mockReturnValue(true)
  jest.mocked(getClient).mockReturnValue({ getLoginInfoByToken, getWorkspaceMembers } as unknown as ReturnType<typeof getClient>)
  getLoginInfoByToken.mockResolvedValue({ workspace, account: actor, role: AccountRole.Owner })
  taskMail.save.mockResolvedValue(undefined)
  taskMail.test.mockResolvedValue(undefined)
  taskMail.get.mockResolvedValue({ settings: defaultDigest, smtpConfigured: false, linkConfigured: true })
})

async function withService (run: (root: string) => Promise<void>): Promise<void> {
  const app = createApp({ accountsUrl: 'https://account.test', workspace }, mail, undefined, undefined, taskMail)
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise<void>((resolve) => { server.once('listening', resolve) })
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/task-mail`)
  } finally {
    await new Promise<void>((resolve, reject) => { server.close((err) => err == null ? resolve() : reject(err)) })
  }
}

const headers = { authorization: 'Bearer dummy-test-token', 'content-type': 'application/json' }

test.each([AccountRole.Owner, AccountRole.Maintainer])('allows a current %s and only sends test mail to that actor', async (role) => {
  getWorkspaceMembers.mockResolvedValue([{ person: actor, role }])
  await withService(async (root) => {
    const state = await fetch(root, { headers })
    expect(await state.json()).toMatchObject({ settings: defaultDigest, smtpConfigured: false })
    const invalid = await fetch(root, { method: 'POST', headers, body: JSON.stringify({ time: '99:99' }) })
    expect(invalid.status).toBe(400)
    const save = await fetch(root, { method: 'POST', headers, body: JSON.stringify(defaultDigest) })
    expect(save.status).toBe(200)
    const send = await fetch(root + '/test', { method: 'POST', headers, body: JSON.stringify({ to: 'ignored@example.test' }) })
    expect(send.status).toBe(200)
    expect(taskMail.test).toHaveBeenCalledWith(workspace, actor)
  })
})

test('uses current workspace membership and refuses a stale owner login', async () => {
  getWorkspaceMembers.mockResolvedValue([{ person: actor, role: AccountRole.User }])
  await withService(async (root) => {
    const response = await fetch(root, { headers })
    expect(response.status).toBe(403)
    expect(taskMail.get).not.toHaveBeenCalled()
  })
})
