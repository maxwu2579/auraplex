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
// from reserving the same provider number at the same time.
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

  async get (workspaceUuid: WorkspaceUuid, socialId: PersonId): Promise<Integration | undefined> {
    const entries = await this.account.listIntegrations({ kind: whatsappIntegrationKind, workspaceUuid })
    return entries.find((entry) => entry.socialId === socialId)
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
    token?: string,
    displayPhone?: string
  ): Promise<Integration> {
    return await this.serialize(async () => {
      const entries = await this.account.listIntegrations({ kind: whatsappIntegrationKind })
      const existing = entries.find((entry) => entry.workspaceUuid === workspaceUuid && entry.socialId === socialId)
      if (
        entries.some((entry) => entry !== existing && entry.data?.phoneNumberId === ids.phoneNumberId) ||
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
      const integration: Integration = {
        socialId,
        kind: whatsappIntegrationKind,
        workspaceUuid,
        data: { ...ids, connectedOn: Date.now(), ...(displayPhone !== undefined ? { displayPhone } : {}) }
      }
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

  async disconnect (workspaceUuid: WorkspaceUuid, socialId: PersonId): Promise<void> {
    await this.serialize(async () => {
      const existing = await this.get(workspaceUuid, socialId)
      if (existing !== undefined) await this.account.deleteIntegration(this.key(existing))
    })
  }

  // Auraplex: retain Meta credentials when a WAHA session is added to an existing integration.
  async startWaha (workspaceUuid: WorkspaceUuid, socialId: PersonId, session: string): Promise<void> {
    await this.serialize(async () => {
      const existing = await this.get(workspaceUuid, socialId)
      if (existing?.data?.wahaSession === session) return
      const record = { ...existing, workspaceUuid, socialId, kind: whatsappIntegrationKind,
        data: { ...existing?.data, wahaSession: session, wahaStatus: 'STARTING' } }
      if (existing === undefined) await this.account.createIntegration(record)
      else await this.account.updateIntegration(record)
    })
  }

  async updateWaha (session: string, status: string, phone?: string): Promise<Integration | undefined> {
    return await this.serialize(async () => {
      const entries = await this.list()
      const entry = entries.find((item) => item.data?.wahaSession === session)
      if (entry === undefined) return undefined
      if (phone !== undefined && entries.some((other) => other !== entry &&
        (other.data?.wahaPhone === phone || (other.data?.displayPhone ?? '').replace(/[^0-9]/g, '') === phone))) {
        const data = { ...entry.data, wahaStatus: 'CONFLICT', wahaPhone: '' }
        await this.account.updateIntegration({ ...entry, data })
        throw new Error('Conflict')
      }
      if (entry.data?.wahaStatus === status && (phone === undefined || entry.data?.wahaPhone === phone)) return entry
      const data = { ...entry.data, wahaStatus: status,
        ...(phone === undefined ? {} : {
          wahaPhone: phone,
          wahaDisplayPhone: '•••• ' + phone.slice(-4),
          wahaConnectedOn: entry.data?.wahaStatus === 'WORKING' ? entry.data?.wahaConnectedOn : Date.now()
        }) }
      const updated = { ...entry, data }
      await this.account.updateIntegration(updated)
      return updated
    })
  }

  async disconnectWaha (workspaceUuid: WorkspaceUuid, socialId: PersonId): Promise<void> {
    await this.serialize(async () => {
      const entry = await this.get(workspaceUuid, socialId)
      if (entry?.data?.wahaSession === undefined) return
      if (entry.data.phoneNumberId === undefined) {
        await this.account.deleteIntegration(this.key(entry))
        return
      }
      const data = { ...entry.data }
      for (const field of ['wahaSession', 'wahaStatus', 'wahaPhone', 'wahaDisplayPhone', 'wahaConnectedOn']) delete data[field]
      await this.account.updateIntegration({ ...entry, data })
    })
  }

  private key (integration: Integration): IntegrationKey {
    return { kind: whatsappIntegrationKind, socialId: integration.socialId, workspaceUuid: integration.workspaceUuid }
  }
}
