// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { formatMarketingMail, introCandidates, isOptOutReply, readAutomationSettings, defaultAutomation } from './automation'
import type { Prospect } from './index'

const card = (id: string, email: string, fields: Partial<Prospect> = {}): Prospect => ({
  _id: id, email, createdOn: 20, status: 'new', emailCount: 0,
  name: 'Test Customer', company: 'Example Co', title: 'Buyer', ...fields
} as Prospect)

test('only new, unique, eligible customers with no prior send enter the introduction pool', () => {
  const customers = [
    card('yes', 'hello@example.test'),
    card('empty', ''),
    card('bad', 'bad@'),
    card('dup1', 'Same@example.test'), card('dup2', 'same@example.test'),
    card('stopped', 'stopped@example.test', { status: 'do-not-send' }),
    card('bounce', 'bounce@example.test', { status: 'bounced' }),
    card('converted', 'converted@example.test', { status: 'converted' }),
    card('prior', 'prior@example.test', { emailCount: 1 }),
    card('logged', 'logged@example.test'),
    card('cancelled', 'cancelled@example.test'),
    card('old', 'old@example.test', { createdOn: 9 })
  ]
  expect(introCandidates(customers, 10, new Set(['cancelled']), new Set(['logged'])).map((p) => p._id)).toEqual(['yes'])
})

test('formats both variable spellings and adds opt-out instructions', () => {
  const message = formatMarketingMail({ subject: 'For {姓名}', body: '{company} {职位} {owner}' }, card('yes', 'hello@example.test'), 'Fake Owner')
  expect(message.subject).toBe('For Test Customer')
  expect(message.body).toContain('Example Co Buyer Fake Owner')
  expect(message.body).toContain('Reply STOP')
})

test('recognises a first-line opt-out without treating a quoted footer as consent withdrawal', () => {
  expect(isOptOutReply('  STOP!\n\nQuoted message')).toBe(true)
  expect(isOptOutReply('退订')).toBe(true)
  expect(isOptOutReply('', 'Re: unsubscribe')).toBe(true)
  expect(isOptOutReply('Can I get details?\n> Reply STOP or unsubscribe.')).toBe(false)
  expect(readAutomationSettings({ ...defaultAutomation, enabled: true })).toBeUndefined()
  expect(readAutomationSettings(defaultAutomation)?.limit).toBe(50)
})
