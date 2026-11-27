// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import { defaultProspectFields, orderedProspectFields, parseProspectDate, visibleProspectFields } from '../template'

test('the default template preserves all twelve built-in business card fields in order', () => {
  expect(defaultProspectFields.map((field) => field.key)).toEqual([
    'name', 'company', 'title', 'mobile', 'phone', 'email', 'website', 'address', 'country', 'industry', 'source', 'notes'
  ])
  expect(defaultProspectFields.every((field) => field.builtin && !field.hidden && field.label === '')).toBe(true)
})

test('name and company stay visible even when hidden or omitted; email may be hidden', () => {
  const fields = defaultProspectFields
    .filter((field) => field.key !== 'company')
    .map((field) => ({ ...field, hidden: ['name', 'email'].includes(field.key) }))
  expect(visibleProspectFields(fields).map((field) => field.key)).toEqual(
    orderedProspectFields().map((field) => field.key).filter((key) => key !== 'email')
  )
})

test('dates are stored at UTC midnight and invalid calendar dates are rejected', () => {
  expect(parseProspectDate('2028-02-29')).toBe(Date.UTC(2028, 1, 29))
  expect(parseProspectDate('2026-02-29')).toBeUndefined()
  expect(parseProspectDate('2026-11-27T00:00:00Z')).toBeUndefined()
})
