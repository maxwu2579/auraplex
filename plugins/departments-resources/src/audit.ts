// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import core, { getCurrentAccount, type Doc } from '@hcengineering/core'
import departments, { type AuditEvent, type AuditKind } from '@hcengineering/departments'
import { getClient } from '@hcengineering/presentation'

const MERGE_MS = 30 * 60 * 1000

/** Tracking: record an export, or a page opened (repeat opens within 30 minutes only raise the count). */
export async function recordAudit (kind: AuditKind, label: string, doc?: Doc): Promise<void> {
  try {
    const client = getClient()
    const me = getCurrentAccount().uuid
    const now = Date.now()
    if (kind === 'view' && doc !== undefined) {
      const last = await client.findOne(departments.class.AuditEvent, {
        kind: 'view',
        actor: me,
        objectId: doc._id,
        lastOn: { $gte: now - MERGE_MS }
      })
      if (last !== undefined) {
        await client.update(last, { count: last.count + 1, lastOn: now })
        return
      }
    }
    const data: Omit<AuditEvent, keyof Doc> = {
      kind,
      actor: me,
      label,
      count: 1,
      firstOn: now,
      lastOn: now,
      ...(doc !== undefined ? { objectId: doc._id, objectClass: doc._class, objectSpace: doc.space } : {})
    }
    await client.createDoc(departments.class.AuditEvent, core.space.Workspace, data)
  } catch {
    // Tracking must never get in the way of work.
  }
}
