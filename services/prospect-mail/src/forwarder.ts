// Copyright © 2026 Auraplex. Licensed under EPL-2.0.
import contact from '@hcengineering/contact'
import { SocialIdType, type AccountUuid, type Ref, type TxOperations } from '@hcengineering/core'
import prospects, { type Prospect, type ProspectMail } from '@hcengineering/prospects'
import type { Transporter } from 'nodemailer'
import { MailUserError } from './errors'
import { stableMailId } from './sender'

/** Forwards a customer's reply to the prospect's owner. Only ever to the owner's own Huly email. */
export class Forwarder {
  constructor (
    private readonly client: TxOperations,
    private readonly transport: Pick<Transporter, 'sendMail'>,
    private readonly address: string
  ) {}

  async ownerEmail (owner: AccountUuid): Promise<string | undefined> {
    const person = await this.client.findOne(contact.class.Person, { personUuid: owner })
    if (person === undefined) return undefined
    const ids = await this.client.findAll(contact.class.SocialIdentity, {
      attachedTo: person._id,
      type: SocialIdType.EMAIL
    })
    const id = ids.find((it) => it.verifiedOn !== undefined) ?? ids[0]
    return id?.value
  }

  async forward (actor: AccountUuid, prospectId: string, replyId: string, requestId: string): Promise<void> {
    const id = stableMailId('fwd', requestId)
    const existing = await this.client.findOne(prospects.class.ProspectMail, { _id: id })
    if (existing !== undefined) {
      if (existing.delivery === 'sent') return
      throw new Error('Prior forward is pending or uncertain')
    }
    const prospect = await this.client.findOne(prospects.class.Prospect, { _id: prospectId as Ref<Prospect> })
    const reply = await this.client.findOne(prospects.class.ProspectMail, {
      _id: replyId as Ref<ProspectMail>,
      attachedTo: prospectId as Ref<Prospect>,
      direction: 'incoming'
    })
    if (prospect === undefined || reply === undefined) throw new MailUserError('找不到这封回复')
    if (prospect.owner === undefined) throw new MailUserError('请先选择负责人')
    const to = await this.ownerEmail(prospect.owner)
    if (to === undefined || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new MailUserError('负责人没有邮箱')
    const subject = `Fwd: ${reply.subject}`.slice(0, 200)
    const body = [
      `客户 ${prospect.name}（${prospect.company}，${prospect.email}）回复了邮件，由 Auraplex 转给你。`,
      '',
      `发件人：${reply.sender}`,
      `时间：${new Date(reply.sentAt).toLocaleString('zh-CN', { timeZone: 'Asia/Singapore' })}`,
      `主题：${reply.subject}`,
      '',
      reply.body
    ].join('\n')
    const now = Date.now()
    const ops = this.client.apply('prospect-mail-forward')
    ops.notMatch(prospects.class.ProspectMail, { _id: id })
    await ops.addCollection(
      prospects.class.ProspectMail,
      prospect.space,
      prospect._id,
      prospect._class,
      'mailMessages',
      {
        direction: 'forward',
        delivery: 'sending',
        messageId: `<${requestId}@auraplex.local>`,
        sender: this.address,
        recipient: to,
        subject,
        body,
        sentAt: now,
        actor,
        replyTo: reply._id
      },
      id
    )
    if (!(await ops.commit()).result) throw new Error('Cannot reserve forward')
    const finish = async (delivery: ProspectMail['delivery']): Promise<void> => {
      const record = await this.client.findOne(prospects.class.ProspectMail, { _id: id })
      if (record !== undefined && record.delivery === 'sending') await this.client.update(record, { delivery })
    }
    try {
      await this.transport.sendMail({ from: this.address, to, subject, text: body })
    } catch {
      // As with sending, the server may have accepted it; let the user check instead of retrying.
      await finish('uncertain')
      throw new Error('SMTP result uncertain')
    }
    await finish('sent')
  }
}
