//
// Copyright © 2023 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { decodeDocumentId } from '@hcengineering/collaborator-client'
import { MeasureContext } from '@hcengineering/core'
import { decodeToken } from '@hcengineering/server-token'
import { Extension, onAuthenticatePayload, connectedPayload, onDisconnectPayload } from '@hocuspocus/server'
import { isReadOnlyOrGuest } from '@hcengineering/account'

import { Context, buildContext } from '../context'
import { getWorkspaceIds } from '../utils'
import { checkCollaborationAccess } from '../departmentAccess'
import config from '../config'

export interface AuthenticationConfiguration {
  ctx: MeasureContext
}

export class AuthenticationExtension implements Extension {
  private readonly configuration: AuthenticationConfiguration
  private readonly checks = new Map<string, ReturnType<typeof setInterval>>()

  constructor (configuration: AuthenticationConfiguration) {
    this.configuration = configuration
  }

  async onAuthenticate (data: onAuthenticatePayload): Promise<Context> {
    const ctx = this.configuration.ctx
    const { workspaceId } = decodeDocumentId(data.documentName)

    return await ctx.with(
      'authenticate',
      {},
      async () => {
        const token = decodeToken(data.token)
        const readonly = isReadOnlyOrGuest(token.account, token.extra)

        ctx.info('authenticate', {
          workspaceId,
          account: token.account,
          mode: token.extra?.mode ?? '',
          readonly
        })

        if (readonly) {
          data.connection.readOnly = true
        }

        // verify workspace can be accessed with the token
        const ids = await getWorkspaceIds(data.token)

        // verify workspace uuid in the document matches the token
        if (ids.uuid !== workspaceId) {
          throw new Error('documentName must include workspace id')
        }

        const context = buildContext(data, ids)
        const access = await checkCollaborationAccess(token, data.token, context, data.documentName, config.AccountsUrl)
        if (!access.read) throw new Error('Document access denied')
        if (!access.write) data.connection.readOnly = true
        return context
      },
      { workspaceId }
    )
  }

  async connected (data: connectedPayload): Promise<void> {
    const context = data.context as Context
    let running = false
    const interval = setInterval(() => {
      if (running) return
      running = true
      void (async () => {
        try {
          if (context.authToken === undefined) throw new Error('Missing token')
          const token = decodeToken(context.authToken)
          const access = await checkCollaborationAccess(token, context.authToken, context, data.documentName, config.AccountsUrl)
          if (!access.read || access.write === Boolean(data.connectionInstance.readOnly)) data.connectionInstance.close()
        } catch {
          data.connectionInstance.close()
        } finally {
          running = false
        }
      })()
    }, 3000)
    interval.unref()
    const key = `${data.socketId}|${data.documentName}`
    const previous = this.checks.get(key)
    if (previous !== undefined) clearInterval(previous)
    this.checks.set(key, interval)
  }

  async onDisconnect (data: onDisconnectPayload): Promise<void> {
    const key = `${data.socketId}|${data.documentName}`
    const interval = this.checks.get(key)
    if (interval !== undefined) clearInterval(interval)
    this.checks.delete(key)
  }
}
