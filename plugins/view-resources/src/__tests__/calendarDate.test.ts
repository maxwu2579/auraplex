// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import { displayCalendarDate, storeCalendarDate } from '../calendarDate'

test('stores the selected civil date and displays it as the same day in the browser', () => {
  const chosen = new Date(2026, 10, 30, 0, 15)
  const stored = storeCalendarDate(chosen.getTime())
  expect(stored).toBe(Date.UTC(2026, 10, 30))
  const displayed = new Date(displayCalendarDate(stored))
  expect([displayed.getFullYear(), displayed.getMonth(), displayed.getDate()]).toEqual([2026, 10, 30])
})
