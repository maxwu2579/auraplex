// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { TxOperations } from '@hcengineering/core'
import prospects from '@hcengineering/prospects'
import { MailUserError } from './errors'
import type { Forwarder } from './forwarder'
import type { ScheduledRecords } from './scheduledRecords'

/** The recipient list is written atomically with the reply. Restarted workers resume unclaimed recipients. */
export async function forwardPendingReplies (
  client: TxOperations, records: ScheduledRecords, forwarder: Forwarder, onProblem: (event: string) => void
): Promise<void> {
  const replies = await client.findAll(prospects.class.ProspectMail, {
    direction: 'incoming', forwardRecipients: { $exists: true }, forwardedOn: { $exists: false }
  }, { limit: 100 })
  for (const reply of replies) {
    for (const user of new Set(reply.forwardRecipients ?? [])) {
      if (!await records.claim('reply-forward', reply._id, user)) continue
      try {
        await forwarder.forward(user, reply.attachedTo, reply._id, `auto:${reply._id}:${user}`, user)
      } catch (err) {
        onProblem(err instanceof MailUserError ? 'reply-forward-no-email-or-record' : 'reply-forward-smtp')
      }
    }
    await client.update(reply, { forwardedOn: Date.now() })
  }
}
