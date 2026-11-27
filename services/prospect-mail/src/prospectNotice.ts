// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { createHash } from 'node:crypto'
import contact from '@hcengineering/contact'
import { type AccountUuid, type Doc, type Ref, type TxOperations } from '@hcengineering/core'
import notification, { type DocNotifyContext } from '@hcengineering/notification'
import type { IntlString } from '@hcengineering/platform'

export async function addProspectNotice (
  client: TxOperations, ops: ReturnType<TxOperations['apply']>, doc: Doc, user: AccountUuid,
  eventId: string, time: number, header: IntlString, text: string
): Promise<void> {
  const employee = await client.findOne(contact.mixin.Employee, { personUuid: user, active: true })
  if (employee === undefined) return
  const space = await client.findOne(contact.class.PersonSpace, { person: employee._id })
  if (space === undefined) return
  const existing = await client.findOne(notification.class.DocNotifyContext, { objectId: doc._id, user })
  const stable = (prefix: string, value: string): string =>
    prefix + createHash('sha256').update(JSON.stringify([value, user])).digest('hex')
  const ctxId = existing?._id ?? stable('prospect-mail-context-', doc._id) as Ref<DocNotifyContext>
  if (existing === undefined) {
    await ops.createDoc(notification.class.DocNotifyContext, space._id, {
      user, objectId: doc._id, objectClass: doc._class, objectSpace: doc.space,
      hidden: false, isPinned: false, lastUpdateTimestamp: time
    }, ctxId)
  } else {
    await ops.update(existing, { hidden: false, lastUpdateTimestamp: Math.max(existing.lastUpdateTimestamp ?? 0, time) })
  }
  await ops.createDoc(notification.class.CommonInboxNotification, space._id, {
    user, objectId: doc._id, objectClass: doc._class, docNotifyContext: ctxId,
    isViewed: false, archived: false, header,
    messageHtml: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }),
    types: []
  }, stable('prospect-mail-notice-', eventId) as any)
}
