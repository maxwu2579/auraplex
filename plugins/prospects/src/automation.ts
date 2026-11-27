// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid, Doc, Ref } from '@hcengineering/core'
import { prospectMailStatus } from './mailRules'
import { normalizeEmail } from './rules'
import type { Prospect } from './index'

export interface MailTemplate { subject: string, body: string }
export interface AutoMailSettings {
  enabled: boolean
  limit: number
  waitDays: number
  language: 'zh' | 'en'
  zh: MailTemplate
  en: MailTemplate
}
export interface MailCampaign {
  id: string
  title: string
  template: MailTemplate
  start: string
  status: 'active' | 'paused' | 'stopped' | 'done'
  customers: Array<Ref<Prospect>>
  removed: Array<Ref<Prospect>>
  actor: AccountUuid
  notified?: boolean
}
export interface MailAutomation extends Doc {
  settings: AutoMailSettings
  enrolledFrom?: number
  releasedThrough?: number
  removed: Array<Ref<Prospect>>
  campaign?: MailCampaign
}

export const defaultAutomation: AutoMailSettings = {
  enabled: false, limit: 50, waitDays: 3, language: 'zh',
  zh: { subject: '', body: '' }, en: { subject: '', body: '' }
}

export function readMailTemplate (value: unknown): MailTemplate | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const { subject, body } = value as Partial<MailTemplate>
  if (typeof subject !== 'string' || subject.trim() === '' || /[\r\n]/.test(subject) || subject.length > 200 ||
    typeof body !== 'string' || body.trim() === '' || body.length > 28_000) return undefined
  return { subject: subject.trim(), body: body.trim() }
}

export function readAutomationSettings (value: unknown): AutoMailSettings | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const { enabled, limit, waitDays, language, zh, en } = value as AutoMailSettings
  if (typeof enabled !== 'boolean' || !Number.isInteger(limit) || limit < 1 || limit > 500 ||
    !Number.isInteger(waitDays) || waitDays < 1 || waitDays > 90 || !['zh', 'en'].includes(language)) return undefined
  const primary = readMailTemplate(language === 'en' ? en : zh)
  if (enabled && primary === undefined) return undefined
  return { enabled, limit, waitDays, language, zh: readMailTemplate(zh) ?? defaultAutomation.zh, en: readMailTemplate(en) ?? defaultAutomation.en }
}

export function marketingEmail (prospect: Pick<Prospect, 'email' | 'status' | 'mailStatus'>): string | undefined {
  const status = prospectMailStatus(prospect)
  const email = normalizeEmail(prospect.email)
  return status === 'do-not-send' || status === 'bounced' || !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email) ? undefined : email
}

export function introCandidates (customers: Prospect[], after: number, removed: ReadonlySet<string>, mailed: ReadonlySet<string>): Prospect[] {
  const counts = new Map<string, number>()
  for (const item of customers) {
    const email = normalizeEmail(item.email)
    counts.set(email, (counts.get(email) ?? 0) + 1)
  }
  return customers.filter((item) => {
    const email = marketingEmail(item)
    return email !== undefined && counts.get(email) === 1 && (item.createdOn ?? 0) >= after &&
      item.status !== 'converted' && prospectMailStatus(item) === 'new' && (item.emailCount ?? 0) === 0 &&
      item.lastEmailAt === undefined && !removed.has(item._id) && !mailed.has(item._id)
  }).sort((a, b) => (a.createdOn ?? 0) - (b.createdOn ?? 0))
}

export function formatMarketingMail (template: MailTemplate, customer: Prospect, owner: string): MailTemplate {
  const fields: Record<string, string> = {
    name: customer.name, '姓名': customer.name, company: customer.company, '公司': customer.company,
    title: customer.title, '职位': customer.title, owner, '负责人': owner
  }
  const replace = (text: string): string => text.replace(/\{([^{}]+)\}/g, (match, key: string) => fields[key] ?? match)
  return {
    subject: replace(template.subject).replace(/[\r\n]+/g, ' ').slice(0, 200),
    body: replace(template.body).slice(0, 29_000) + '\n\n不想再收到邮件请回复 STOP / Reply STOP or unsubscribe to opt out.'
  }
}

export function isOptOutReply (text: string, subject = ''): boolean {
  const line = text.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? ''
  const command = /^(?:stop|unsubscribe|退订)[.!。！]?$/i
  return command.test(line) || command.test(subject.replace(/^(?:re|fw|fwd):\s*/i, '').trim())
}
