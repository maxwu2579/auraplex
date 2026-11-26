import { canSendMail, matchReply, messageIds, updateProspectMailStatus, type Prospect, type ProspectMail } from '..'
function prospect (id: string, email: string, status: Prospect['status'] = 'new'): Prospect {
  const partial: Partial<Prospect> = { _id: id as Prospect['_id'], email, status }
  return partial as Prospect
}
function sent (id: string, person: Prospect, time = 100): ProspectMail {
  const partial: Partial<ProspectMail> = {
    messageId: id,
    attachedTo: person._id,
    direction: 'outgoing',
    delivery: 'sent',
    sentAt: time
  }
  return partial as ProspectMail
}
test('blocks opt-outs, bounced mail and rapid repeats', () => {
  expect(canSendMail(prospect('a', 'test@example.test', 'do-not-send'), 100000)).toBeDefined()
  expect(canSendMail(prospect('a', 'test@example.test', 'bounced'), 100000)).toBeDefined()
  expect(canSendMail({ ...prospect('a', 'test@example.test'), lastEmailAt: 1000 }, 2000)).toBeDefined()
  expect(canSendMail({ ...prospect('a', 'test@example.test'), lastEmailAt: 1000 }, 61000)).toBeUndefined()
  expect(canSendMail(prospect('a', 'not-an-email'), 100000)).toBeDefined()
})
test('uses reply headers ahead of the sender email', () => {
  const a = prospect('a', 'a@example.test')
  const b = prospect('b', 'b@example.test')
  const outbound = sent('<a@example.test>', a)
  expect(messageIds('other <a@example.test> <b@example.test>')).toEqual(['<a@example.test>', '<b@example.test>'])
  expect(matchReply(b.email, ['<a@example.test>'], [outbound], [a, b])).toEqual({
    kind: 'matched',
    prospect: a,
    outgoing: outbound
  })
})
test('matches sender only when unique and with an earlier sent email', () => {
  const a = prospect('a', 'A@example.test')
  const b = prospect('b', 'a@example.test')
  const outbound = sent('<a@example.test>', a)
  expect(matchReply(' a@example.test ', [], [outbound], [a])).toEqual({
    kind: 'matched',
    prospect: a,
    outgoing: outbound
  })
  expect(matchReply('a@example.test', [], [outbound], [a, b])).toEqual({ kind: 'ambiguous' })
  expect(matchReply('a@example.test', [], [], [a])).toEqual({ kind: 'unmatched' })
  expect(
    matchReply('a@example.test', ['<a@example.test> <b@example.test>'], [outbound, sent('<b@example.test>', b)], [a, b])
  ).toEqual({ kind: 'ambiguous' })
})

test('conversion preserves outbound mail blocks and keeps the lead state after a mail update', () => {
  const converted = prospect('test', 'test@example.test', 'converted')
  expect(canSendMail({ ...converted, mailStatus: 'bounced' }, 100)).toBeDefined()
  expect(canSendMail({ ...converted, mailStatus: 'do-not-send' }, 100)).toBeDefined()
  expect(updateProspectMailStatus(converted, 'replied')).toEqual({ mailStatus: 'replied' })
})
