// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { Ref } from '@hcengineering/core'
import type { Prospect } from './index'
import { duplicatePairs, duplicateWhy, mergedStatus, phoneKey, reviewReasons, similarNames } from './review'

const card = (id: string, patch: Partial<Prospect> = {}): Prospect => ({
  _id: id as Ref<Prospect>, name: '', company: '', mobile: '', phone: '', email: '', normalizedEmail: '', ...patch
} as unknown as Prospect)

test('phone and name keys', () => {
  expect(phoneKey('+65 6123-4567')).toBe(phoneKey('61234567'))
  expect(phoneKey('1234')).toBe('')
  expect(similarNames('Wang Wei', 'wang wei')).toBe(true)
  expect(similarNames('王伟', '王伟 Peter')).toBe(true)
  expect(similarNames('A', 'A')).toBe(false)
})

test('duplicates by email, phone, or same company with a similar name', () => {
  const a = card('a', { name: '测试 王', company: '测试有限公司', mobile: '+65 9123 4567', normalizedEmail: 'a@fake.test' })
  expect(duplicateWhy(a, card('b', { normalizedEmail: 'a@fake.test' }))).toBe('email')
  expect(duplicateWhy(a, card('b', { phone: '91234567' }))).toBe('phone')
  expect(duplicateWhy(a, card('b', { name: '测试王', company: '测试公司' }))).toBe('name')
  expect(duplicateWhy(a, card('b', { name: '别人', company: '测试公司' }))).toBeUndefined()
  expect(duplicateWhy({ ...a, notDuplicate: ['b' as Ref<Prospect>] }, card('b', { phone: '91234567' }))).toBeUndefined()
  const pairs = duplicatePairs([a, card('b', { phone: '91234567' }), card('c', { normalizedEmail: 'a@fake.test', phone: '91234567' })])
  expect(pairs.map((it) => `${it.a._id}${it.b._id}`).sort()).toEqual(['ab', 'ac', 'bc'])
})

test('review reasons', () => {
  const others = [card('old', { name: '别人', company: '别家', mobile: '91234567' })]
  const draft = { name: '新人', company: '新公司', mobile: '', phone: '', email: '', normalizedEmail: '' }
  expect(reviewReasons(draft, [], others)).toEqual([])
  expect(reviewReasons(draft, ['title'], others)).toEqual(['field:title'])
  expect(reviewReasons({ ...draft, mobile: '+65 9123 4567' }, [], others)).toEqual(['dup:old'])
  expect(reviewReasons({ ...draft, phone: '6123 4567' }, [], others)).toEqual(['switchboard'])
})

test('merged status keeps opt-outs', () => {
  expect(mergedStatus('replied', 'do-not-send')).toBe('do-not-send')
  expect(mergedStatus('new', 'sent')).toBe('sent')
  expect(mergedStatus('converted', 'replied')).toBe('converted')
})
