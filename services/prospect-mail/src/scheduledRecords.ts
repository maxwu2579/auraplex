// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { createHash } from 'node:crypto'
import type { AccountClient, IntegrationSecretKey } from '@hcengineering/account-client'
import type { IntegrationKind, PersonId, WorkspaceUuid } from '@hcengineering/core'

export class ScheduledRecords {
  constructor (private readonly workspace: WorkspaceUuid, private readonly account: AccountClient) {}

  private key (key: string): IntegrationSecretKey {
    return { workspaceUuid: this.workspace, kind: 'auraplex-service-settings' as IntegrationKind, socialId: '0' as PersonId, key }
  }

  /** The account database's unique key arbitrates sends even across separate workers. */
  async claim (kind: string, date: string, ...parts: string[]): Promise<boolean> {
    const hash = createHash('sha256').update(JSON.stringify([kind, date, ...parts])).digest('hex')
    const key = this.key('task-mail:claim:' + hash)
    if (await this.account.getIntegrationSecret(key) != null) return false
    try {
      await this.account.addIntegrationSecret({ ...key, secret: date })
      return true
    } catch (err) {
      if (await this.account.getIntegrationSecret(key) != null) return false
      throw err
    }
  }
}
