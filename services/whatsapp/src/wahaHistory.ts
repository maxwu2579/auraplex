// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { Integration } from '@hcengineering/account-client'
import type { Config } from './config'
import type { ConnectionStore } from './integrations'
import type { WorkspaceReceiver } from './workspaceClient'
import { runtimeConfig } from './serviceSettings'
import { WahaClient, parseWahaEvent, sessionName } from './waha'

const pageSize = 50
const dayMs = 86_400_000
const pause = async (): Promise<void> => await new Promise((resolve) => setTimeout(resolve, 250))

export class WahaHistory {
  private timer?: ReturnType<typeof setInterval>
  private running?: Promise<void>
  private stopped = false

  constructor (
    private readonly config: Config,
    private readonly store: ConnectionStore,
    private readonly receiver: WorkspaceReceiver,
    private readonly request: typeof fetch = fetch
  ) {}

  start (): void {
    if (this.config.provider !== 'waha') return
    this.timer = setInterval(() => { this.schedule() }, 60_000)
    this.schedule()
  }

  private schedule (): void {
    if (this.running !== undefined || this.stopped) return
    this.running = this.scan().catch(() => {}).finally(() => { this.running = undefined })
  }

  async close (): Promise<void> {
    this.stopped = true
    if (this.timer !== undefined) clearInterval(this.timer)
    await this.running
  }

  private async scan (): Promise<void> {
    for (const entry of await this.store.list()) {
      if (this.stopped) return
      if (entry.workspaceUuid == null || entry.data?.wahaStatus !== 'WORKING') continue
      try {
        await this.import(entry)
      } catch {
        await this.store.saveWahaHistory(entry, { wahaHistoryState: 'failed' }).catch(() => {})
      }
    }
  }

  private async import (entry: Integration): Promise<void> {
    if (entry.workspaceUuid == null) return
    const session = entry.data?.wahaSession
    const phone = entry.data?.wahaPhone
    if (session !== sessionName(entry.workspaceUuid, entry.socialId) || typeof phone !== 'string') return
    const config = runtimeConfig(this.config, await this.store.serviceSettings(entry.workspaceUuid))
    const now = Date.now()
    const importDays = config.historyDays ?? 0
    const initial = importDays > 0 && entry.data?.wahaInitialHistory !== true
    const since = Math.floor(Math.max(now - (initial ? importDays : importDays || 3) * dayMs, initial ? 0 :
      typeof entry.data?.wahaHistoryUntil === 'number' ? entry.data.wahaHistoryUntil : entry.data?.wahaConnectedOn ?? now) / 1000)
    const until = Math.floor(now / 1000)
    if (since >= until) return
    const call = async <T>(operation: (client: WahaClient) => Promise<T>): Promise<T> =>
      await this.store.wahaRequest(entry, config, this.request, async (scoped) => await operation(new WahaClient(scoped, this.request)))
    const client = await this.receiver.getClient(entry.workspaceUuid)
    let processed = 0
    if (initial) await this.store.saveWahaHistory(entry, { wahaHistoryState: 'running', wahaHistoryCount: 0 })
    for (let offset = 0; !this.stopped; offset += pageSize) {
      const chats = await call(async (waha) => await waha.historyChats(session, offset, pageSize))
      await pause()
      for (const { id } of chats) {
        if (this.stopped) return
        if (typeof id !== 'string' || !/^\d+@(?:c\.us|lid)$/.test(id)) continue
        const peer = id.endsWith('@lid') ? await call(async (waha) => await waha.resolveLid(session, id)) ?? id : id
        for (let at = 0; !this.stopped; at += pageSize) {
          const rows = await call(async (waha) => await waha.historyMessages(session, id, since, until, at, pageSize))
          await pause()
          for (const row of rows) {
            const parsed = parseWahaEvent('message.any', session, phone, { ...row, chatId: peer }).messages[0]
            if (parsed !== undefined) {
              await this.receiver.receive(client, entry, { ...parsed, historical: true })
              processed++
            }
          }
          if (initial && rows.length > 0) await this.store.saveWahaHistory(entry, { wahaHistoryCount: processed })
          if (rows.length < pageSize) break
        }
      }
      if (chats.length < pageSize) break
    }
    if (this.stopped) return
    await this.store.saveWahaHistory(entry, { wahaHistoryUntil: until * 1000,
      ...(initial ? { wahaInitialHistory: true, wahaHistoryState: 'done', wahaHistoryCount: processed } : {}) })
  }
}
