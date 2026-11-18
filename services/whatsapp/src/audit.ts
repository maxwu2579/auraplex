// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import core, { type Class, type Doc, type Ref, type TxOperations } from '@hcengineering/core'
import type { WhatsappMessage } from '@hcengineering/whatsapp'

interface WhatsappAuditEvent extends Doc {
  kind: 'whatsapp'
  actor: NonNullable<WhatsappMessage['owner']>
  label: string
  firstOn: number
  lastOn: number
  count: number
}

const auditEvent = 'departments:class:AuditEvent' as Ref<Class<WhatsappAuditEvent>>

export async function recordWhatsappExchange (
  client: TxOperations,
  operations: Pick<TxOperations, 'createDoc'>,
  owner: NonNullable<WhatsappMessage['owner']>,
  counterpart: string,
  time: number
): Promise<void> {
  if (client.getHierarchy().findClass(auditEvent) === undefined) return
  await operations.createDoc(auditEvent, core.space.Workspace, {
    kind: 'whatsapp',
    actor: owner,
    label: counterpart,
    firstOn: time,
    lastOn: time,
    count: 1
  })
}
