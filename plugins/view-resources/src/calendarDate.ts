// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
/** Calendar-only dates keep the same day across time zones. */
export function displayCalendarDate(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12).getTime()
}

export function storeCalendarDate(timestamp: number): number {
  const date = new Date(timestamp)
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
}
