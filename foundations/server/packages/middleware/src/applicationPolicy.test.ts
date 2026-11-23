//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import {
  canChangeExecutionStatus,
  canChangeRequest,
  isApplicationLocked,
  touchesApplicationContent
} from './applicationPolicy'

describe('application policy', () => {
  it('content is the title, text and own fields, not counters', () => {
    expect(touchesApplicationContent({ title: 'x' })).toBe(true)
    expect(touchesApplicationContent({ custom6affef723aaeb27ca52d3f7c: 88 })).toBe(true)
    expect(touchesApplicationContent({ comments: 2 })).toBe(false)
    expect(touchesApplicationContent({ readonly: true })).toBe(false)
  })

  it('locked after an approval, unless that process was withdrawn or cancelled', () => {
    expect(isApplicationLocked([{ user: 'a', execution: 'e1' }], new Set())).toBe(false)
    expect(isApplicationLocked([{ user: 'a', execution: 'e1', approved: false }], new Set())).toBe(false)
    expect(isApplicationLocked([{ user: 'a', execution: 'e1', approved: true }], new Set())).toBe(true)
    expect(isApplicationLocked([{ user: 'a', execution: 'e1', approved: true }], new Set(['e1']))).toBe(false)
  })

  it('only the assigned person decides or hands on a step', () => {
    const req = { user: 'boss', execution: 'e1' }
    expect(canChangeRequest({ approved: true, doneOn: 1 }, 'boss', req)).toBe(true)
    expect(canChangeRequest({ approved: true, doneOn: 1 }, 'staff', req)).toBe(false)
    expect(canChangeRequest({ user: 'staff' }, 'staff', req)).toBe(false)
    expect(canChangeRequest({ user: 'finance' }, 'boss', req)).toBe(true)
    expect(canChangeRequest({ rank: '0|a' }, 'staff', req)).toBe(true)
    expect(canChangeRequest({ doneOn: 1 }, undefined, req)).toBe(false)
  })

  it('only the applicant stops the process, and only by cancelling', () => {
    expect(canChangeExecutionStatus({ status: 'cancelled' }, true)).toBe(true)
    expect(canChangeExecutionStatus({ status: 'cancelled' }, false)).toBe(false)
    expect(canChangeExecutionStatus({ status: 'done' }, true)).toBe(false)
    expect(canChangeExecutionStatus({ cancelReason: 'x' }, false)).toBe(true)
  })
})
