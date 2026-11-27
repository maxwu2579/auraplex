// Copyright © 2026 Auraplex. Licensed under EPL-2.0.
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { type ParsedReply } from './receiver'

export interface Cursor {
  uidValidity: string
  uid: number
}
export interface PollStorage {
  read: () => Promise<Cursor | undefined>
  write: (cursor: Cursor) => Promise<void>
  accept: (reply: ParsedReply) => Promise<unknown>
}

/** One connection and one sequential pass; a failed message is retried next time. */
export async function pollInbox (client: ImapFlow, storage: PollStorage): Promise<void> {
  await client.connect()
  try {
    const mailbox = await client.mailboxOpen('INBOX', { readOnly: true })
    const validity = String(mailbox.uidValidity)
    const previous = await storage.read()
    if (previous?.uidValidity !== validity) {
      // First run (or the mailbox was rebuilt): never import old mail. Only mail that
      // arrives from now on can be a reply to something we sent.
      await storage.write({ uidValidity: validity, uid: Math.max(0, Number(mailbox.uidNext ?? 1) - 1) })
      return
    }
    let uid = previous.uid
    const ids = await client.search({ uid: `${uid + 1}:*` }, { uid: true })
    for (const id of (ids === false || ids === undefined ? [] : ids)
      .filter((value) => value > uid)
      .sort((a, b) => a - b)) {
      const meta = await client.fetchOne(String(id), { uid: true, size: true }, { uid: true })
      if (meta === false) throw new Error('Message disappeared')
      // Do not download large messages or attachments into memory: read only their headers,
      // which is enough to match the reply; the user reads the full message in the mailbox.
      const large = meta.size === undefined || meta.size > 1024 * 1024
      {
        const item = await client.fetchOne(
          String(id),
          large ? { uid: true, headers: true } : { uid: true, source: true },
          { uid: true }
        )
        const raw = item === false ? undefined : large ? item.headers : item.source
        if (raw === undefined) throw new Error('Message unavailable')
        const mail = await simpleParser(raw, { skipTextToHtml: true })
        const from = mail.from?.value[0]?.address ?? ''
        const refs = [
          mail.inReplyTo ?? '',
          ...(Array.isArray(mail.references) ? mail.references : [mail.references ?? ''])
        ]
        await storage.accept({
          uidValidity: validity,
          uid: id,
          messageId: mail.messageId ?? '',
          from,
          subject: (mail.subject ?? '').slice(0, 200),
          text: large ? '（这封邮件比较大，正文没有读取，请到邮箱里查看。）' : (mail.text ?? '').slice(0, 4000),
          sentAt: mail.date?.getTime() ?? Date.now(),
          references: refs
        })
      }
      uid = id
      await storage.write({ uidValidity: validity, uid })
    }
  } finally {
    await client.logout().catch(() => {
      client.close()
    })
  }
}
