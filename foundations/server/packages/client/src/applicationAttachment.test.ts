// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { getClient } from '@hcengineering/account-client'
import type { WorkspaceUuid } from '@hcengineering/core'
import { decodeToken } from '@hcengineering/server-token'
import { canDownloadApplicationAttachment } from './applicationAttachment'
import { createClient } from './client'

jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/server-token', () => ({
  generateToken: () => 'fake-service',
  decodeToken: jest.fn()
}))
jest.mock('./client', () => ({ createClient: jest.fn() }))

test('attachment access checks every protected parent with the caller identity', async () => {
  const workspace = 'fake-workspace' as WorkspaceUuid
  const resolver = { domainRequest: jest.fn(), close: jest.fn() }
  const caller = { findAll: jest.fn(), close: jest.fn() }
  ;(getClient as jest.Mock).mockReturnValue({ selectWorkspace: async () => ({ endpoint: 'ws://fake.test' }) })
  ;(decodeToken as jest.Mock).mockReturnValue({ workspace })
  ;(createClient as jest.Mock).mockImplementation(async (_url, token) =>
    token === 'fake-service' ? resolver : caller)

  resolver.domainRequest.mockResolvedValue({ value: [] })
  await expect(canDownloadApplicationAttachment('http://fake.test', workspace, 'ordinary'))
    .resolves.toEqual({ allowed: true, restricted: false })
  expect(caller.findAll).not.toHaveBeenCalled()

  resolver.domainRequest.mockResolvedValue({ value: ['card-a', 'card-b'] })
  await expect(canDownloadApplicationAttachment('http://fake.test', workspace, 'private'))
    .resolves.toEqual({ allowed: false, restricted: true })
  caller.findAll.mockResolvedValue([{ _id: 'card-a' }])
  await expect(canDownloadApplicationAttachment('http://fake.test', workspace, 'private', 'fake-caller'))
    .resolves.toEqual({ allowed: false, restricted: true })
  caller.findAll.mockResolvedValue([{ _id: 'card-a' }, { _id: 'card-b' }])
  await expect(canDownloadApplicationAttachment('http://fake.test', workspace, 'private', 'fake-caller'))
    .resolves.toEqual({ allowed: true, restricted: true })
  expect(resolver.close).toHaveBeenCalledTimes(4)
  expect(caller.close).toHaveBeenCalledTimes(2)
})
