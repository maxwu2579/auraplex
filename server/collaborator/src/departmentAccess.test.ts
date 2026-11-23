import { connect } from './platform'
// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { getClient } from '@hcengineering/account-client'
import {
  canInvokeCollaborationRpc,
  canReadCollaborationSource,
  checkCollaborationAccess,
  decideCollaborationAccess,
  type CollaborationAccessInput
} from './departmentAccess'

jest.mock('@hcengineering/account-client', () => ({
  getClient: jest.fn(),
  isWorkspaceLoginInfo: (value: any) => value?.workspace !== undefined
}))
jest.mock('@hcengineering/account', () => ({ isReadOnlyOrGuest: jest.fn(() => false) }))

const base: CollaborationAccessInput = {
  actor: 'reader',
  workspaceMatches: true,
  service: false,
  owner: false,
  workspaceReadOnly: false,
  space: { private: true, members: ['reader', 'employee'] },
  department: {
    administrators: [],
    supervisors: [],
    employees: ['employee'],
    readers: ['reader'],
    adminPermissions: ['update'],
    supervisorPermissions: ['update'],
    employeePermissions: ['update'],
    readerPermissions: ['comment']
  }
}
jest.mock('./platform', () => ({ connect: jest.fn() }))

test('rejects a private space nonmember', () => {
  expect(decideCollaborationAccess({ ...base, actor: 'outsider' })).toEqual({ read: false, write: false })
})
test('reader can read but cannot write; employee can do both', () => {
  expect(decideCollaborationAccess(base)).toEqual({ read: true, write: false })
  expect(decideCollaborationAccess({ ...base, actor: 'employee' })).toEqual({ read: true, write: true })
})
test('owner and authenticated service can read and write', () => {
  expect(decideCollaborationAccess({ ...base, actor: 'owner', owner: true })).toEqual({ read: true, write: true })
  expect(decideCollaborationAccess({ ...base, actor: 'service', service: true })).toEqual({ read: true, write: true })
})
test('missing spaces and cross-workspace requests are rejected', () => {
  expect(decideCollaborationAccess({ ...base, space: undefined })).toEqual({ read: false, write: false })
  expect(decideCollaborationAccess({ ...base, service: true, workspaceMatches: false })).toEqual({
    read: false,
    write: false
  })
})

test('RPC endpoints use the same read and write decisions', () => {
  const readonly = decideCollaborationAccess(base)
  expect(canInvokeCollaborationRpc('getContent', readonly)).toBe(true)
  expect(canInvokeCollaborationRpc('createContent', readonly)).toBe(false)
  expect(canInvokeCollaborationRpc('updateContent', readonly)).toBe(false)
  const member = decideCollaborationAccess({ ...base, actor: 'employee' })
  expect(canInvokeCollaborationRpc('getContent', member)).toBe(true)
  expect(canInvokeCollaborationRpc('createContent', member)).toBe(true)
  expect(canInvokeCollaborationRpc('updateContent', member)).toBe(true)
  expect(canInvokeCollaborationRpc('unexpectedMethod', member)).toBe(false)
})

test('a supplied source must belong to the requested document', () => {
  expect(canReadCollaborationSource(undefined, 'stored')).toBe(true)
  expect(canReadCollaborationSource('stored', 'stored')).toBe(true)
  expect(canReadCollaborationSource('another-private-blob', 'stored')).toBe(false)
})

test('resolver checks the stored space, department and authenticated account', async () => {
  const department = { ...base.department, projectSpace: 'private-space' }
  const close = jest.fn()
  const client = {
    findOne: jest.fn(async (cls: string) =>
      cls === 'core:class:Space'
        ? { _id: 'private-space', private: true, members: ['reader', 'employee'] }
        : { _id: 'doc', _class: 'test:class:Document', space: 'private-space' }
    ),
    findAll: jest.fn(async () => [{ 'departments:mixin:DepartmentAccess': department }]),
    getHierarchy: () => ({
      findAttribute: () => ({ type: { _class: 'core:class:TypeCollaborativeDoc' } }),
      isDerived: (left: string, right: string) => left === right
    }),
    close
  }
  const context: any = { wsIds: { uuid: 'workspace' }, clientFactory: async () => client }
  const login = { account: 'reader', workspace: 'workspace', role: 'USER' }
  ;(getClient as jest.Mock).mockReturnValue({ getLoginInfoByToken: async () => login })
  const token: any = { account: 'reader', workspace: 'workspace', extra: {} }
  expect(
    await checkCollaborationAccess(token, 'fake', context, 'workspace|class|doc|body', 'http://account.test')
  ).toMatchObject({ read: true, write: false })
  login.account = token.account = 'employee'
  expect(
    await checkCollaborationAccess(token, 'fake', context, 'workspace|class|doc|body', 'http://account.test')
  ).toMatchObject({ read: true, write: true })
  login.account = token.account = 'outsider'
  expect(
    await checkCollaborationAccess(token, 'fake', context, 'workspace|class|doc|body', 'http://account.test')
  ).toMatchObject({ read: false, write: false })
  expect(close).toHaveBeenCalledTimes(3)
})

test('a missing document can only create an isolated draft for a workspace member', async () => {
  const client = { findOne: jest.fn().mockResolvedValue(undefined), close: jest.fn() }
  const context: any = { wsIds: { uuid: 'workspace' }, clientFactory: async () => client }
  const login = { account: 'reader', workspace: 'workspace', role: 'USER' }
  ;(getClient as jest.Mock).mockReturnValue({ getLoginInfoByToken: async () => login })
  const token: any = { account: 'reader', workspace: 'workspace', extra: {} }
  expect(
    await checkCollaborationAccess(token, 'fake', context, 'workspace|class|new|body', 'http://account.test')
  ).toEqual({
    read: false,
    write: false,
    allowDraft: true
  })
  login.role = 'GUEST'
  expect(
    await checkCollaborationAccess(token, 'fake', context, 'workspace|class|new|body', 'http://account.test')
  ).toEqual({
    read: false,
    write: false,
    allowDraft: false
  })
})

test('an existing application card requires a successful read with the user token', async () => {
  const cardClass = 'card:class:Card'
  const client = {
    findOne: jest.fn().mockResolvedValue({ _id: 'private-application', _class: cardClass }),
    getHierarchy: () => ({ isDerived: (left: string, right: string) => left === right }),
    close: jest.fn()
  }
  const caller = { findAll: jest.fn().mockResolvedValue([]), close: jest.fn() }
  ;(connect as jest.Mock).mockResolvedValue(caller)
  ;(getClient as jest.Mock).mockReturnValue({
    getLoginInfoByToken: async () => ({ account: 'employee', workspace: 'workspace', role: 'USER' })
  })
  const context: any = { wsIds: { uuid: 'workspace' }, clientFactory: async () => client }
  const token: any = { account: 'employee', workspace: 'workspace', extra: {} }
  await expect(checkCollaborationAccess(token, 'fake', context, 'workspace|class|doc|body', 'http://account.test'))
    .resolves.toEqual({ read: false, write: false })
  expect(connect).toHaveBeenCalledWith('fake')
  expect(caller.close).toHaveBeenCalledTimes(1)
})
