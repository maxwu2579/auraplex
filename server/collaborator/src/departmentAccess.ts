// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { getClient, isWorkspaceLoginInfo } from '@hcengineering/account-client'
import { isReadOnlyOrGuest } from '@hcengineering/account'
import { decodeDocumentId } from '@hcengineering/collaborator-client'
import core, { AccountRole, roleOrder, type Class, type Doc, type Ref, type Space } from '@hcengineering/core'
import { type Token } from '@hcengineering/server-token'
import { type Context } from './context'

export interface DepartmentAccessSnapshot {
  administrators: readonly string[]
  supervisors: readonly string[]
  employees: readonly string[]
  readers: readonly string[]
  adminPermissions: readonly string[]
  supervisorPermissions: readonly string[]
  employeePermissions: readonly string[]
  readerPermissions: readonly string[]
}

export interface CollaborationAccessInput {
  actor: string
  workspaceMatches: boolean
  service: boolean
  owner: boolean
  workspaceReadOnly: boolean
  space?: { private: boolean, members: readonly string[] }
  department?: DepartmentAccessSnapshot
}

export function canInvokeCollaborationRpc (method: string, access: { read: boolean, write: boolean }): boolean {
  if (method === 'getContent') return access.read
  if (method === 'createContent' || method === 'updateContent') return access.read && access.write
  return false
}

export function canReadCollaborationSource (source: unknown, storedSource: unknown): boolean {
  return source == null || (typeof source === 'string' && source === storedSource)
}

/** Data must come from the authenticated account and authoritative server storage. */
export function decideCollaborationAccess (input: CollaborationAccessInput): { read: boolean, write: boolean } {
  if (!input.workspaceMatches) return { read: false, write: false }
  if (input.service) return { read: true, write: true }
  if (input.space === undefined) return { read: false, write: false }
  if (input.space.private && !input.owner && !input.space.members.includes(input.actor)) {
    return { read: false, write: false }
  }
  if (input.workspaceReadOnly) return { read: true, write: false }
  if (input.owner) return { read: true, write: true }
  const department = input.department
  if (department === undefined) return { read: true, write: true }
  const includes = (members: readonly string[], permissions: readonly string[]): boolean =>
    members.includes(input.actor) && permissions.includes('update')
  const write =
    includes(department.administrators, department.adminPermissions) ||
    includes(department.administrators, department.supervisorPermissions) ||
    includes(department.supervisors, department.supervisorPermissions) ||
    includes(department.employees, department.employeePermissions) ||
    includes(department.readers, department.readerPermissions)
  return { read: true, write }
}

/** Re-read the document and private space using the server client for every decision. */
export async function checkCollaborationAccess (
  token: Token,
  rawToken: string,
  context: Context,
  documentName: string,
  accountsUrl: string
): Promise<{ read: boolean, write: boolean, allowDraft?: boolean, storedSource?: unknown }> {
  const { workspaceId, documentId } = decodeDocumentId(documentName)
  const workspaceMatches = workspaceId === context.wsIds.uuid && token.workspace === context.wsIds.uuid
  if (!workspaceMatches) return { read: false, write: false }
  if (token.extra?.service !== undefined && token.extra.service !== '') return { read: true, write: true }
  const account = await getClient(accountsUrl, rawToken).getLoginInfoByToken()
  if (!isWorkspaceLoginInfo(account) || account.workspace !== context.wsIds.uuid || account.account !== token.account) {
    return { read: false, write: false }
  }
  const client = await context.clientFactory()
  try {
    const object = await client.findOne(documentId.objectClass, { _id: documentId.objectId })
    if (object === undefined) {
      // New tasks create an unattached content blob before their document exists.
      // This permits only that isolated draft, never access to an existing document.
      return {
        read: false,
        write: false,
        allowDraft:
          roleOrder[account.role] >= roleOrder[AccountRole.User] && !isReadOnlyOrGuest(token.account, token.extra)
      }
    }
    const hierarchy = client.getHierarchy()
    const attribute = hierarchy.findAttribute(object._class, documentId.objectAttr)
    if (attribute === undefined || !hierarchy.isDerived(attribute.type._class, core.class.TypeCollaborativeDoc)) {
      return { read: false, write: false }
    }
    const spaceId = hierarchy.isDerived(object._class, core.class.Space) ? (object._id as Ref<Space>) : object.space
    const space = await client.findOne(core.class.Space, { _id: spaceId })
    if (space === undefined) return { read: false, write: false }
    const departmentClass = 'hr:class:Department' as Ref<Class<Doc>>
    const accessKey = 'departments:mixin:DepartmentAccess'
    const departments = await client.findAll(departmentClass, {})
    const matching = departments.flatMap((department) => {
      const access = (department as unknown as Record<string, unknown>)[accessKey] as
        | (DepartmentAccessSnapshot & {
          projectSpace?: string
          documentSpace?: string
          driveSpace?: string
        })
        | undefined
      return access !== undefined && [access.projectSpace, access.documentSpace, access.driveSpace].includes(spaceId)
        ? [access]
        : []
    })
    if (matching.length > 1) return { read: false, write: false }
    const access = matching[0]
    if (
      access !== undefined &&
      ![
        access.administrators,
        access.supervisors,
        access.employees,
        access.readers,
        access.adminPermissions,
        access.supervisorPermissions,
        access.employeePermissions,
        access.readerPermissions
      ].every(Array.isArray)
    ) {
      return { read: false, write: false }
    }
    const decision = decideCollaborationAccess({
      actor: account.account,
      workspaceMatches,
      service: false,
      owner: account.role === AccountRole.Owner,
      workspaceReadOnly: isReadOnlyOrGuest(token.account, token.extra),
      space,
      department: access
    })
    return { ...decision, storedSource: (object as unknown as Record<string, unknown>)[documentId.objectAttr] }
  } finally {
    await client.close()
  }
}
