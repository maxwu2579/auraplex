// Copyright © 2026 Auraplex. Licensed under EPL-2.0.
import contact, { type Employee } from '@hcengineering/contact'
import { type AccountUuid, type Ref, type TxOperations } from '@hcengineering/core'
import prospects, {
  isOptOutReply, matchReply, normalizeEmail, prospectMailStatus, prospectWriteScope, updateProspectMailStatus, type ProspectMail
} from '@hcengineering/prospects'
import time, { ToDoPriority, type ToDo } from '@hcengineering/time'
import { addProspectNotice } from './prospectNotice'
import { replyPeople, nextWorkdayEnd, followUpTitle } from './replyFollowUp'
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
export class Receiver {
  constructor (
    private readonly client: TxOperations,
    private readonly leads: () => Promise<AccountUuid[]> = async () => []
  ) {}
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
    if (matched.kind !== 'matched' || normalizeEmail(reply.from) === '' ||
      normalizeEmail(reply.from) !== normalizeEmail(matched.outgoing.recipient)) return 'unmatched'
    const prospect = matched.prospect
    const optOut = isOptOutReply(reply.text, reply.subject)
    const recipients = replyPeople(prospect.owner, matched.outgoing.actor, optOut ? [] : await this.leads(), optOut)
    const now = Date.now()
    const ops = this.client.apply(prospectWriteScope)
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
        replyTo: matched.outgoing._id,
        ...(!optOut && recipients.length > 0 ? { forwardRecipients: recipients } : {})
      },
      id
    )
    ops.match(prospects.class.Prospect, { _id: prospect._id, modifiedOn: prospect.modifiedOn })
    const mailStatus = prospectMailStatus(prospect)
    const changes = optOut
      ? (prospect.status === 'converted' ? { mailStatus: 'do-not-send' as const } : { status: 'do-not-send' as const })
      : mailStatus === 'do-not-send' || mailStatus === 'bounced' ? {} : updateProspectMailStatus(prospect, 'replied')
    if (!optOut && prospect.owner !== undefined) {
      const employee = await this.client.findOne(contact.mixin.Employee, { personUuid: prospect.owner, active: true })
      if (employee !== undefined) {
        const followUp = stableMailId('follow-up', id) as unknown as Ref<ToDo>
        await ops.createDoc(time.class.ToDo, time.space.ToDos, {
          user: employee._id as Ref<Employee>, title: followUpTitle(prospect), description: '',
          dueDate: nextWorkdayEnd(now), doneOn: null, workslots: 0, priority: ToDoPriority.NoPriority,
          visibility: 'private', rank: '0|hzzzzz:',
          attachedTo: prospect._id, attachedToClass: prospect._class, attachedSpace: prospect.space, collection: 'replyFollowUps'
        }, followUp)
        Object.assign(changes, { followUp })
      }
    }
    if (Object.keys(changes).length > 0) await ops.update(prospect, changes)
    for (const user of recipients) {
      await addProspectNotice(this.client, ops, prospect, user, id, now,
        optOut ? prospects.string.AutoMailOptOut : prospects.string.AutoMailCustomerReply,
        optOut ? prospect.name : [prospect.name, reply.subject, reply.text.slice(0, 400)].filter(Boolean).join(' · '))
    }
    if (!(await ops.commit()).result) throw new Error('Reply was concurrently processed or customer changed')
    return 'recorded'
  }
}
