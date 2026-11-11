//
// Copyright © 2026 Auraplex
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

import type { AccountClient, Integration, IntegrationKey } from '@hcengineering/account-client'
import { whatsappIntegrationKind } from '@hcengineering/whatsapp'
import type { PersonId, WorkspaceUuid } from '@hcengineering/core'

export interface ConnectionIds {
  phoneNumberId: string
  wabaId: string
}

export function validIds (value: ConnectionIds): boolean {
  return (
    typeof value?.phoneNumberId === 'string' &&
    /^\d{1,64}$/.test(value.phoneNumberId) &&
    typeof value?.wabaId === 'string' &&
    /^\d{1,64}$/.test(value.wabaId)
  )
}

// One service process owns connection writes. Serializing them prevents two administrators
// from connecting different numbers to the same workspace at the same time.
export class ConnectionStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor (private readonly account: AccountClient) {}

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.catch(() => {})
    return await result
  }

  async findByPhoneNumberId (phoneNumberId: string): Promise<Integration | undefined> {
    const entries = await this.account.listIntegrations({ kind: whatsappIntegrationKind })
    const matches = entries.filter(
      (entry) => entry.workspaceUuid != null && entry.data?.phoneNumberId === phoneNumberId
    )
    if (matches.length > 1) throw new Error('Ambiguous phone number integration')
    return matches[0]
  }

  async get (workspaceUuid: WorkspaceUuid): Promise<Integration | undefined> {
    const entries = await this.account.listIntegrations({ kind: whatsappIntegrationKind, workspaceUuid })
    return entries[0]
  }

  async list (): Promise<Integration[]> {
    return await this.account.listIntegrations({ kind: whatsappIntegrationKind })
  }

  async accessToken (integration: Integration): Promise<string | undefined> {
    const value = await this.account.getIntegrationSecret({ ...this.key(integration), key: 'access-token' })
    return value?.secret
  }

  async connect (
    workspaceUuid: WorkspaceUuid,
    socialId: PersonId,
    ids: ConnectionIds,
    token?: string
  ): Promise<Integration> {
    return await this.serialize(async () => {
      const entries = await this.account.listIntegrations({ kind: whatsappIntegrationKind })
      const existing = entries.find((entry) => entry.workspaceUuid === workspaceUuid)
      if (
        entries.some(
          (entry) => entry.workspaceUuid !== workspaceUuid && entry.data?.phoneNumberId === ids.phoneNumberId
        ) ||
        (existing !== undefined &&
          (existing.socialId !== socialId ||
            existing.data?.phoneNumberId !== ids.phoneNumberId ||
            existing.data?.wabaId !== ids.wabaId))
      ) {
        throw new Error('CONFLICT')
      }
      if (existing !== undefined) {
        if (token !== undefined) {
          await this.account.updateIntegrationSecret({ ...this.key(existing), key: 'access-token', secret: token })
        }
        return existing
      }
      if (token === undefined) throw new Error('TOKEN_REQUIRED')
      const integration: Integration = { socialId, kind: whatsappIntegrationKind, workspaceUuid, data: { ...ids } }
      await this.account.createIntegration(integration)
      try {
        await this.account.addIntegrationSecret({ ...this.key(integration), key: 'access-token', secret: token })
      } catch (err) {
        // Do not leave a connected card behind if the secret could not be saved.
        await this.account.deleteIntegration(this.key(integration))
        throw err
      }
      return integration
    })
  }

  async disconnect (workspaceUuid: WorkspaceUuid): Promise<void> {
    await this.serialize(async () => {
      const existing = await this.get(workspaceUuid)
      if (existing !== undefined) await this.account.deleteIntegration(this.key(existing))
    })
  }

  private key (integration: Integration): IntegrationKey {
    return { kind: whatsappIntegrationKind, socialId: integration.socialId, workspaceUuid: integration.workspaceUuid }
  }
}
