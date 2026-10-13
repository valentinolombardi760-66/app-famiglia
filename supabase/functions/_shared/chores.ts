// Chore schedules and their reminders.
// Shared by the web app and the send-reminders Edge Function, so it must stay
// free of browser-only and Deno-only APIs.

import { FAMILY_TZ, fromWallTime, toDateKey } from './recurrence.ts'

export type ChoreSchedule = 'daily' | 'days' | 'weekly' | 'once'

export interface Chore {
  id: string
  title: string
  assigned_to: string
  schedule: ChoreSchedule
  /** ISO weekdays (1 = Monday). 'days': when it's due; 'weekly': the one deadline day. */
  weekdays: number[] | null
  /** 'once' only: the deadline. */
  due_on: string | null
  /** First day a recurring chore counts. */
  starts_on: string
}

/** A chore not ticked by this hour on its due day gets a reminder. */
export const CHORE_REMINDER_HOUR = 19

function keyToUtc(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function addDaysToKey(key: string, n: number): string {
  const d = keyToUtc(key)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a "YYYY-MM-DD" day. */
export function weekdayOfKey(key: string): number {
  return ((keyToUtc(key).getUTCDay() + 6) % 7) + 1
}

// Upper bound on generated days per call, so a bad range can't hang the UI.
const MAX_DAYS = 400

/** Days in [from, to) on which the chore is due. */
export function choreDueDates(chore: Chore, from: string, to: string): string[] {
  if (chore.schedule === 'once') {
    return chore.due_on && chore.due_on >= from && chore.due_on < to ? [chore.due_on] : []
  }
  const days = new Set(chore.weekdays ?? [])
  const out: string[] = []
  let day = from > chore.starts_on ? from : chore.starts_on
  for (let i = 0; day < to && i < MAX_DAYS; i++, day = addDaysToKey(day, 1)) {
    if (chore.schedule === 'daily' || days.has(weekdayOfKey(day))) out.push(day)
  }
  return out
}

export const completionKey = (choreId: string, dueOn: string) => `${choreId}|${dueOn}`

export interface DueChoreReminder {
  /** Unique per chore and due day, used to never send twice. */
  key: string
  choreId: string
  assignedTo: string
  title: string
  body: string
}

/**
 * Reminders for chores due today whose reminder time falls in (windowStart, now]
 * and that nobody has ticked. `done` holds completionKey()s.
 */
export function dueChoreReminders(
  chores: Chore[],
  done: Set<string>,
  windowStart: Date,
  now: Date,
  tz = FAMILY_TZ,
): DueChoreReminder[] {
  const from = toDateKey(windowStart, tz)
  const to = addDaysToKey(toDateKey(now, tz), 1)
  const due: DueChoreReminder[] = []
  for (const chore of chores) {
    for (const day of choreDueDates(chore, from, to)) {
      const [y, m, d] = day.split('-').map(Number)
      const fireAt = fromWallTime(y, m, d, CHORE_REMINDER_HOUR, 0, tz)
      if (fireAt.getTime() <= windowStart.getTime() || fireAt.getTime() > now.getTime()) continue
      if (done.has(completionKey(chore.id, day))) continue
      due.push({
        key: `chore|${chore.id}|${day}`,
        choreId: chore.id,
        assignedTo: chore.assigned_to,
        title: `🧹 ${chore.title}`,
        body: chore.schedule === 'daily' || chore.schedule === 'days'
          ? 'Da fare oggi: non è ancora segnata come fatta.'
          : 'Scade oggi: non è ancora segnata come fatta.',
      })
    }
  }
  return due
}
