import { findDuplicates, normalizeEmail, normalizePhone, parseRecognition, prospectStats, type Prospect } from '..'

function prospect (values: Partial<Prospect>): Prospect {
  return values as Prospect
}
test('normalizes and detects email and phone duplicates separately', () => {
  const old = prospect({
    _id: 'a' as Prospect['_id'],
    email: ' Person@Example.test ',
    mobile: '+65 1234-5678',
    phone: ''
  })
  expect(normalizeEmail(' PERSON@EXAMPLE.TEST ')).toBe('person@example.test')
  expect(normalizeEmail('PERSON @ EXAMPLE.TEST')).toBe('person@example.test')
  expect(normalizePhone('+65 (1234) 5678')).toBe('6512345678')
  expect(findDuplicates({ email: 'person@example.test', mobile: '', phone: '65 12345678' }, [old])).toEqual({
    email: old,
    phones: [old]
  })
  expect(findDuplicates({ email: '', mobile: '', phone: '' }, [old]).phones).toEqual([])
  expect(findDuplicates({ email: 'person@example.test', mobile: '', phone: '' }, [old], old._id).email).toBeUndefined()
})
test('counts this week and month and groups empty fields', () => {
  const now = new Date(2026, 10, 18, 12)
  const records = [
    prospect({
      createdOn: new Date(2026, 10, 17).getTime(),
      source: '展会',
      country: 'SG',
      industry: '',
      status: 'new'
    }),
    prospect({ createdOn: new Date(2026, 10, 1).getTime(), source: '展会', country: '', industry: '', status: 'sent' })
  ]
  const stats = prospectStats(records, now)
  expect([stats.total, stats.week, stats.month]).toEqual([2, 1, 2])
  expect(stats.source['展会']).toBe(2)
  expect(stats.industry['未填写']).toBe(2)
})
test('validates recognized fields without copying unknown keys', () => {
  const result = parseRecognition({
    name: ' Test ',
    email: 'bad@@x',
    mobile: 'abc',
    website: 'javascript:alert(1)',
    secret: 'ignore'
  })
  expect(result.values.name).toBe('Test')
  expect(result.values.email).toBe('')
  expect(result.needsReview).toEqual(['mobile', 'email', 'website'])
  expect(Object.keys(result.values)).not.toContain('secret')
  expect(() => parseRecognition('[]')).toThrow()
  expect(parseRecognition('{"email":"test@example.test","website":"https://example.test"}').needsReview).toEqual([])
  expect(parseRecognition('{"email":null}').needsReview).toEqual(['email'])
})
