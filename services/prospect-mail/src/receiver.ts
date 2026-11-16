// Copyright © 2026 Auraplex. Licensed under EPL-2.0.
import { createHash } from 'crypto'
import contact, { type PersonSpace } from '@hcengineering/contact'
import { type AccountUuid, type Doc, type Ref, type TxOperations } from '@hcengineering/core'
import notification, { type DocNotifyContext } from '@hcengineering/notification'
import prospects, { matchReply, type ProspectMail } from '@hcengineering/prospects'
import { stableMailId } from './sender'

export interface ParsedReply {
  uidValidity: string
  uid: number
  messageId: string
  from: string
  subject: string
  text: string
  sentAt: number
  references: string[]
}
function contextId (prospectId: string, user: string): Ref<DocNotifyContext> {
  return ('prospect-mail-context-' +
    createHash('sha256')
      .update(JSON.stringify([prospectId, user]))
      .digest('hex')) as Ref<DocNotifyContext>
}
export class Receiver {
  constructor (private readonly client: TxOperations) {}
  async accept (reply: ParsedReply): Promise<'recorded' | 'duplicate' | 'unmatched'> {
    const id = stableMailId('in', reply.uidValidity, String(reply.uid))
    if ((await this.client.findOne(prospects.class.ProspectMail, { _id: id })) !== undefined) return 'duplicate'
    if (
      reply.messageId !== '' &&
      (await this.client.findOne(prospects.class.ProspectMail, {
        direction: 'incoming',
        messageId: reply.messageId
      })) !== undefined
    ) {
      return 'duplicate'
    }
    const outgoing = await this.client.findAll(prospects.class.ProspectMail, {
      direction: 'outgoing',
      delivery: 'sent'
    })
    const customers = await this.client.findAll(prospects.class.Prospect, {})
    // A reply cannot be older than the mail it answers (allow 10 minutes of clock difference).
    const earlier = outgoing.filter((item) => item.sentAt <= reply.sentAt + 10 * 60000)
    const matched = matchReply(reply.from, reply.references, earlier, customers)
    if (matched.kind !== 'matched') return 'unmatched'
    const user = matched.outgoing.actor
    const ops = this.client.apply('prospect-mail-receive')
    ops.notMatch(prospects.class.ProspectMail, { _id: id })
    if (reply.messageId !== '') {
      ops.notMatch(prospects.class.ProspectMail, { direction: 'incoming', messageId: reply.messageId })
    }
    await ops.addCollection(
      prospects.class.ProspectMail,
      matched.prospect.space,
      matched.prospect._id,
      matched.prospect._class,
      'mailMessages',
      {
        direction: 'incoming',
        delivery: 'received',
        messageId: reply.messageId,
        sender: reply.from,
        recipient: matched.outgoing.sender,
        subject: reply.subject.slice(0, 200),
        body: reply.text.slice(0, 4000),
        sentAt: reply.sentAt,
        replyTo: matched.outgoing._id
      },
      id
    )
    // Keep a prior opt-out or bounce in force; receiving a reply must not re-enable marketing mail.
    if (matched.prospect.status !== 'do-not-send' && matched.prospect.status !== 'bounced') {
      ops.match(prospects.class.Prospect, { _id: matched.prospect._id, status: matched.prospect.status })
      await ops.update(matched.prospect, { status: 'replied' })
    }
    if (user !== undefined) await this.addNotification(ops, matched.prospect, user, id, reply.sentAt)
    if (!(await ops.commit()).result) throw new Error('Reply was concurrently processed or customer changed')
    return 'recorded'
  }

  private async addNotification (
    ops: ReturnType<TxOperations['apply']>,
    prospect: Doc,
    user: AccountUuid,
    reply: Ref<ProspectMail>,
    time: number
  ): Promise<void> {
    const employee = await this.client.findOne(contact.mixin.Employee, { personUuid: user, active: true })
    if (employee === undefined) return
    const space = await this.client.findOne(contact.class.PersonSpace, { person: employee._id })
    if (space === undefined) throw new Error('Notification space missing')
    const existing = await this.client.findOne(notification.class.DocNotifyContext, { objectId: prospect._id, user })
    const ctxId = existing?._id ?? contextId(prospect._id, user)
    if (existing === undefined) {
      await ops.createDoc(
        notification.class.DocNotifyContext,
        space._id,
        {
          user,
          objectId: prospect._id,
          objectClass: prospect._class,
          objectSpace: prospect.space,
          hidden: false,
          isPinned: false,
          lastUpdateTimestamp: time
        },
        ctxId
      )
    } else {
      await ops.update(existing, {
        hidden: false,
        lastUpdateTimestamp: Math.max(existing.lastUpdateTimestamp ?? 0, time)
      })
    }
    await ops.createDoc(
      notification.class.CommonInboxNotification,
      space._id as Ref<PersonSpace>,
      {
        user,
        objectId: prospect._id,
        objectClass: prospect._class,
        docNotifyContext: ctxId,
        isViewed: false,
        archived: false,
        header: prospects.string.Prospects,
        messageHtml: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '客户回复了邮件，请打开客户资料查看。' }] }]
        }),
        types: []
      },
      stableMailId('notification', reply, user) as any
    )
  }
}
