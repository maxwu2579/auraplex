// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import core, { getCurrentAccount, type Class, type Doc, type Ref } from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'

// Defined by the departments plugin; spelled out so the workbench does not depend on it.
const auditClass = 'departments:class:AuditEvent' as Ref<Class<Doc>>
const MERGE_MS = 30 * 60 * 1000

function titleOf (doc: Doc): string {
  const it = doc as unknown as Record<string, unknown>
  for (const key of ['identifier', 'title', 'name', 'number', 'code']) {
    if (typeof it[key] === 'string' && it[key] !== '') return it[key] as string
  }
  return ''
}

/**
 * Tracking: remember that the current person opened this page. Opening the same page again
 * within 30 minutes only raises the count. Never blocks or breaks opening the page.
 */
export async function recordView (doc: Doc): Promise<void> {
  try {
    const client = getClient()
    if (!client.getHierarchy().hasClass(auditClass)) return
    const me = getCurrentAccount().uuid
    const now = Date.now()
    const last = (await client.findOne(auditClass, {
      kind: 'view',
      actor: me,
      objectId: doc._id,
      lastOn: { $gte: now - MERGE_MS }
    } as any)) as (Doc & { count: number }) | undefined
    if (last !== undefined) {
      await client.update(last, { count: last.count + 1, lastOn: now } as any)
    } else {
      await client.createDoc(auditClass, core.space.Workspace, {
        kind: 'view',
        actor: me,
        label: titleOf(doc),
        objectId: doc._id,
        objectClass: doc._class,
        objectSpace: doc.space,
        count: 1,
        firstOn: now,
        lastOn: now
      } as any)
    }
  } catch {
    // Tracking must never get in the way of work.
  }
}
