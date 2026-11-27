// Copyright © 2026 Auraplex. Licensed under EPL-2.0.
import { createHash } from 'crypto'
import { type AccountUuid, type Ref, type TxOperations } from '@hcengineering/core'
import prospects, { canSendMail, prospectMailStatus, prospectWriteScope, updateProspectMailStatus, type Prospect, type ProspectMail } from '@hcengineering/prospects'
import type { Transporter } from 'nodemailer'
import { MailUserError } from './errors'

export function stableMailId (kind: string, ...parts: string[]): Ref<ProspectMail> {
  return ('prospect-mail-' +
    kind +
    '-' +
    createHash('sha256').update(JSON.stringify(parts)).digest('hex')) as Ref<ProspectMail>
}

export class Sender {
  constructor (
    private readonly client: TxOperations,
    private readonly transport: Transporter,
    private readonly address: string
  ) {}

  async send (actor: AccountUuid, prospectId: string, requestId: string, subject: string, body: string, automatic?: { kind: 'intro' | 'campaign', campaign?: string, revision: number }): Promise<void> {
    const id = stableMailId('out', requestId)
    const existing = await this.client.findOne(prospects.class.ProspectMail, { _id: id })
    if (existing !== undefined) {
      if (existing.delivery === 'sent') return
      throw new Error('Prior request is still pending or its result is uncertain')
    }
    const prospect = await this.client.findOne(prospects.class.Prospect, { _id: prospectId as Ref<Prospect> })
    if (prospect === undefined) throw new MailUserError('找不到这个客户')
    const refusal = canSendMail(prospect, Date.now())
    if (refusal !== undefined) throw new MailUserError(refusal)
    const now = Date.now()
    const messageId = `<${requestId}@auraplex.local>`
    const ops = this.client.apply(prospectWriteScope)
    ops.match(prospects.class.Prospect, { _id: prospect._id, email: prospect.email, modifiedOn: prospect.modifiedOn })
    ops.notMatch(prospects.class.ProspectMail, { _id: id })
    if (automatic !== undefined) {
      ops.match(prospects.class.MailAutomation, { _id: prospects.ids.MailAutomation, modifiedOn: automatic.revision })
    }
    if (automatic?.kind === 'intro') ops.notMatch(prospects.class.ProspectMail, { attachedTo: prospect._id, direction: 'outgoing' })
    // An unresolved SMTP result may have been delivered. Never start another
    // attempt for this customer until that result has been investigated.
    ops.notMatch(prospects.class.ProspectMail, {
      attachedTo: prospect._id,
      direction: 'outgoing',
      delivery: { $in: ['sending', 'uncertain'] }
    })
    ops.notMatch(prospects.class.ProspectMail, {
      attachedTo: prospect._id,
      direction: 'outgoing',
      sentAt: { $gte: now - 60000 }
    })
    await ops.addCollection(
      prospects.class.ProspectMail,
      prospect.space,
      prospect._id,
      prospect._class,
      'mailMessages',
      {
        direction: 'outgoing',
        delivery: 'sending',
        messageId,
        sender: this.address,
        recipient: prospect.email.trim(),
        subject,
        body,
        sentAt: now,
        actor,
        ...(automatic === undefined ? {} : { automation: automatic.kind, campaign: automatic.campaign })
      },
      id
    )
    if (!(await ops.commit()).result) {
      throw new MailUserError('这个客户还有一封邮件结果没确认，或 1 分钟内刚发过，请先看发送记录。')
    }
    // Once SMTP has been called, a connection error can mean the server accepted the message.
    // Never retry automatically: retain the reservation and ask the user to check the mailbox.
    const current = await this.client.findOne(prospects.class.Prospect, { _id: prospect._id })
    if (current === undefined || current.email !== prospect.email || canSendMail(current, Date.now()) !== undefined) {
      const record = await this.client.findOne(prospects.class.ProspectMail, { _id: id })
      if (record !== undefined && record.delivery === 'sending') {
        await this.client.update(record, { delivery: 'failed' })
      }
      throw new Error('Customer no longer eligible')
    }
    try {
      await this.transport.sendMail({ from: this.address, to: prospect.email.trim(), subject, text: body, messageId })
    } catch {
      const record = await this.client.findOne(prospects.class.ProspectMail, { _id: id })
      if (record !== undefined && record.delivery === 'sending') {
        await this.client.update(record, { delivery: 'uncertain' })
      }
      throw new Error('SMTP result uncertain')
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const record = await this.client.findOne(prospects.class.ProspectMail, { _id: id })
      const latest = await this.client.findOne(prospects.class.Prospect, { _id: prospect._id })
      if (record?.delivery === 'sent') return
      if (record === undefined || latest === undefined) break
      const result = this.client.apply(prospectWriteScope)
      result.match(prospects.class.ProspectMail, { _id: id, delivery: 'sending' })
      result.match(prospects.class.Prospect, { _id: latest._id, modifiedOn: latest.modifiedOn })
      await result.update(record, { delivery: 'sent' })
      await result.update(latest, {
        lastEmailAt: now,
        ...(prospectMailStatus(latest) === 'new' ? updateProspectMailStatus(latest, 'sent') : {})
      })
      await result.update(latest, { $inc: { emailCount: 1 } })
      if ((await result.commit()).result) return
    }
    throw new Error('Cannot save delivery result')
  }
}
