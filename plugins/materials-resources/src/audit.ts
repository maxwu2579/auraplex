// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import core, { getCurrentAccount, type Class, type Doc, type Ref } from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'

// Tracking record class of the departments plugin, spelled out to avoid depending on it.
const auditClass = 'departments:class:AuditEvent' as Ref<Class<Doc>>

/** Tracking: remember that the current person exported data. Never gets in the way of the export. */
export async function recordExport (label: string): Promise<void> {
  try {
    const client = getClient()
    if (!client.getHierarchy().hasClass(auditClass)) return
    const now = Date.now()
    await client.createDoc(auditClass, core.space.Workspace, {
      kind: 'export',
      actor: getCurrentAccount().uuid,
      label,
      count: 1,
      firstOn: now,
      lastOn: now
    } as any)
  } catch {}
}
