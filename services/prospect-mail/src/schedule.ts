// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
export { singaporeClock, singaporeZone, orderDeadline, isOverdue } from '@hcengineering/departments'
export const workdays = [1, 2, 3, 4, 5]

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
