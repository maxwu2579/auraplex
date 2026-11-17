// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { classifyDepartmentAction } from './departmentAction'

const base = { actorIdentities: new Set(['email:user@example.test']), isDerived: (a: string, b: string) => a === b }
test('comments, reactions and attachments to verified comments require comment permission', () => {
  expect(classifyDepartmentAction({ ...base, action: 'create', objectClass: 'chunter:class:ChatMessage' })).toBe(
    'comment'
  )
  expect(classifyDepartmentAction({ ...base, action: 'create', objectClass: 'activity:class:Reaction' })).toBe(
    'comment'
  )
  expect(
    classifyDepartmentAction({
      ...base,
      action: 'create',
      objectClass: 'attachment:class:Attachment',
      parentClass: 'chunter:class:ChatMessage'
    })
  ).toBe('comment')
  expect(
    classifyDepartmentAction({
      ...base,
      action: 'create',
      objectClass: 'attachment:class:Attachment',
      parentClass: 'tracker:class:Issue'
    })
  ).toBe('create')
})
test('removal uses the stored author and authenticated identities', () => {
  for (const objectClass of ['chunter:class:ChatMessage', 'activity:class:Reaction']) {
    expect(
      classifyDepartmentAction({ ...base, action: 'remove', objectClass, existingAuthor: 'email:user@example.test' })
    ).toBe('comment')
    expect(
      classifyDepartmentAction({ ...base, action: 'remove', objectClass, existingAuthor: 'email:other@example.test' })
    ).toBe('delete')
    expect(classifyDepartmentAction({ ...base, action: 'remove', objectClass })).toBe('delete')
  }
})
