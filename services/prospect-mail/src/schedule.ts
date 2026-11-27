// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
export const singaporeZone = 'Asia/Singapore'
export const workdays = [1, 2, 3, 4, 5]
const dayMs = 86_400_000
const singaporeDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: singaporeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  hourCycle: 'h23', hour: '2-digit', minute: '2-digit'
})

export function singaporeClock (now: number): { date: string, weekday: number, time: string, end: number } {
  const parts = Object.fromEntries(singaporeDate.formatToParts(now).map(({ type, value }) => [type, value]))
  const date = `${parts.year}-${parts.month}-${parts.day}`
  const start = Date.parse(`${date}T00:00:00+08:00`)
  return { date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), time: `${parts.hour}:${parts.minute}`, end: start + dayMs }
}

export function orderDeadline (stage: { status: string, startedOn?: number, limitDays?: number }): number | undefined {
  if ((stage.status !== 'active' && stage.status !== 'approval') ||
    stage.startedOn === undefined || stage.limitDays === undefined || stage.limitDays <= 0) return undefined
  return stage.startedOn + stage.limitDays * dayMs
}

export function isOverdue (due: number | null | undefined, finished: boolean, now: number): boolean {
  return !finished && due != null && due < now
}

export interface Team<T> {
  administrators?: T[]
  supervisors?: T[]
  employees?: T[]
  readers?: T[]
  archived?: boolean
}

export function reminderRecipients<T> (teams: Array<Team<T>>, person: T | undefined, stageTeam?: Team<T>): T[] {
  const relevant = stageTeam !== undefined ? [stageTeam] : teams.filter((team) =>
    person !== undefined && [team.administrators, team.supervisors, team.employees, team.readers]
      .some((members) => members?.includes(person) === true)
  )
  const people = new Set<T>(person === undefined ? [] : [person])
  for (const team of relevant) {
    if (team.archived !== true) for (const lead of [...(team.administrators ?? []), ...(team.supervisors ?? [])]) people.add(lead)
  }
  return [...people]
}

/** Polling stays independent of IMAP or SMTP and waits for the previous pass to finish. */
export function startScheduledChecks (
  check: (now: number) => Promise<void>, onFailure: () => void, intervalMs = 60_000
): void {
  const tick = (): void => {
    void check(Date.now()).catch(onFailure).finally(() => { setTimeout(tick, intervalMs) })
  }
  setTimeout(tick, 5000)
}
