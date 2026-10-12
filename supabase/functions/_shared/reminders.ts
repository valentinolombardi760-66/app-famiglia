import { expandOccurrences, fromWallTime, toWallTime, FAMILY_TZ, type RecurringEvent } from './recurrence.ts'

export interface ReminderEvent extends RecurringEvent {
  id: string
  title: string
  all_day: boolean
  location: string | null
  /** Minutes before the start at which to remind, e.g. [60] for one hour before. */
  reminder_minutes: number[]
  /** Also remind at 20:00 the evening before. */
  remind_evening_before: boolean
}

export interface DueReminder {
  /** Unique per event occurrence and reminder, used to never send twice. */
  key: string
  eventId: string
  title: string
  body: string
  occurrenceStart: Date
  fireAt: Date
}

export const EVENING_HOUR = 20

// How far ahead a reminder can be: the longest "minutes before" option is one
// day, and "the evening before" is at most ~28 hours before a 23:59 start.
const LOOKAHEAD_MS = 2 * 86_400_000

/**
 * Reminders whose fire time falls in (windowStart, now].
 * The caller runs this every few minutes with an overlapping window and
 * de-duplicates on `key`, so a late or skipped run doesn't lose reminders.
 */
export function dueReminders(
  events: ReminderEvent[],
  windowStart: Date,
  now: Date,
  tz = FAMILY_TZ,
): DueReminder[] {
  const due: DueReminder[] = []
  for (const event of events) {
    const occurrences = expandOccurrences(event, windowStart, new Date(now.getTime() + LOOKAHEAD_MS), tz)
    for (const occ of occurrences) {
      const fireTimes: { kind: string; at: Date }[] = []
      for (const minutes of event.reminder_minutes ?? []) {
        if (event.all_day) continue
        fireTimes.push({ kind: `m${minutes}`, at: new Date(occ.start.getTime() - minutes * 60_000) })
      }
      if (event.remind_evening_before) {
        const w = toWallTime(occ.start, tz)
        const prev = new Date(Date.UTC(w.year, w.month - 1, w.day) - 86_400_000)
        fireTimes.push({
          kind: 'eve',
          at: fromWallTime(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), EVENING_HOUR, 0, tz),
        })
      }
      for (const f of fireTimes) {
        if (f.at.getTime() <= windowStart.getTime() || f.at.getTime() > now.getTime()) continue
        due.push({
          key: `${event.id}|${occ.start.toISOString()}|${f.kind}`,
          eventId: event.id,
          title: event.title,
          body: describe(event, occ.start, f.at, tz),
          occurrenceStart: occ.start,
          fireAt: f.at,
        })
      }
    }
  }
  return due
}

function describe(event: ReminderEvent, start: Date, fireAt: Date, tz: string): string {
  const w = toWallTime(start, tz)
  const f = toWallTime(fireAt, tz)
  const dayDiff = Math.round(
    (Date.UTC(w.year, w.month - 1, w.day) - Date.UTC(f.year, f.month - 1, f.day)) / 86_400_000,
  )
  const when = dayDiff === 0 ? 'Oggi' : dayDiff === 1 ? 'Domani' : `Il ${w.day}/${w.month}`
  const time = `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`
  const place = event.location ? ` · ${event.location}` : ''
  return event.all_day ? `${when}, tutto il giorno${place}` : `${when} alle ${time}${place}`
}
