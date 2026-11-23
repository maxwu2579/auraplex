// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { getClient } from '@hcengineering/account-client'
import {
  systemAccountUuid, type Class, type Doc, type OperationDomain, type Ref, type WorkspaceUuid
} from '@hcengineering/core'
import { decodeToken, generateToken } from '@hcengineering/server-token'
import { createClient } from './client'

/** Resolve protected attachment parents with the system identity, then authorize with the caller identity. */
export async function canDownloadApplicationAttachment (
  accountsUrl: string, workspace: WorkspaceUuid, file: string, callerToken?: string
): Promise<{ allowed: boolean, restricted: boolean }> {
  const serviceToken = generateToken(systemAccountUuid, workspace, { service: 'application-attachment' })
  const workspaceLogin = await getClient(accountsUrl, serviceToken, 5000).selectWorkspace('', 'internal')
  if (workspaceLogin === undefined) return { allowed: false, restricted: true }
  const resolver = await createClient(workspaceLogin.endpoint, serviceToken, undefined, 5000)
  let parents: Array<Ref<Doc>>
  try {
    const response = await resolver.domainRequest('application-attachment' as OperationDomain, { file })
    if (!Array.isArray(response.value) || response.value.some((id) => typeof id !== 'string')) return { allowed: false, restricted: true }
    parents = response.value
  } finally {
    await resolver.close()
  }
  if (parents.length === 0) return { allowed: true, restricted: false }
  if (callerToken === undefined) return { allowed: false, restricted: true }
  if (decodeToken(callerToken).workspace !== workspace) return { allowed: false, restricted: true }
  const caller = await createClient(workspaceLogin.endpoint, callerToken, undefined, 5000)
  try {
    const rows = await caller.findAll('card:class:Card' as Ref<Class<Doc>>, { _id: { $in: parents } })
    const visible = new Set(rows.map((row) => row._id))
    return { allowed: parents.every((id) => visible.has(id)), restricted: true }
  } finally {
    await caller.close()
  }
}
