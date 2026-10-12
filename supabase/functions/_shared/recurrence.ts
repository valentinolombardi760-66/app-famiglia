// Shared by the web app and the send-reminders Edge Function, so it must stay
// free of browser-only and Deno-only APIs.

export const FAMILY_TZ = 'Europe/Rome'

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly'

export interface RecurringEvent {
  starts_at: string
  ends_at: string
  recurrence: Recurrence
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. Only used when recurrence is 'weekly'. */
  recurrence_weekdays: number[] | null
  /** Last day (YYYY-MM-DD, family time zone) on which an occurrence may start. */
  recurrence_until: string | null
}

export interface Occurrence {
  start: Date
  end: Date
}

export interface WallTime {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  /** ISO weekday, 1 = Monday ... 7 = Sunday. */
  weekday: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

/** Wall-clock time of an instant in the given time zone. */
export function toWallTime(date: Date, tz = FAMILY_TZ): WallTime {
  const parts: Record<string, number> = {}
  for (const p of formatterFor(tz).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  const jsDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    weekday: jsDay === 0 ? 7 : jsDay,
  }
}

function offsetMs(date: Date, tz: string): number {
  const p: Record<string, number> = {}
  for (const part of formatterFor(tz).formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** Instant at which the wall clock in `tz` shows the given time. */
export function fromWallTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz = FAMILY_TZ,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const first = guess - offsetMs(new Date(guess), tz)
  const second = guess - offsetMs(new Date(first), tz)
  return new Date(second)
}

/** YYYY-MM-DD of an instant in the family time zone. */
export function toDateKey(date: Date, tz = FAMILY_TZ): string {
  const w = toWallTime(date, tz)
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// Upper bound on generated occurrences per call, so a bad range can't hang the UI.
const MAX_OCCURRENCES = 1000

/**
 * Occurrences of an event that overlap [rangeStart, rangeEnd).
 * Repeats keep the same wall-clock time in the family time zone, so a
 * weekly 18:00 training stays at 18:00 across daylight-saving changes.
 */
export function expandOccurrences(
  event: RecurringEvent,
  rangeStart: Date,
  rangeEnd: Date,
  tz = FAMILY_TZ,
): Occurrence[] {
  const start = new Date(event.starts_at)
  const end = new Date(event.ends_at)
  const duration = Math.max(0, end.getTime() - start.getTime())
  const overlaps = (s: Date, e: Date) =>
    s.getTime() < rangeEnd.getTime() &&
    (e.getTime() > rangeStart.getTime() || (duration === 0 && s.getTime() >= rangeStart.getTime()))

  if (event.recurrence === 'none') {
    return overlaps(start, end) ? [{ start, end }] : []
  }

  const first = toWallTime(start, tz)
  const weekdays =
    event.recurrence_weekdays && event.recurrence_weekdays.length > 0
      ? new Set(event.recurrence_weekdays)
      : new Set([first.weekday])

  // Walk calendar days (as UTC dates, which have no DST) from whichever is
  // later: the first occurrence, or the range start minus the event length.
  const firstDay = Date.UTC(first.year, first.month - 1, first.day)
  const rangeFirst = toWallTime(new Date(rangeStart.getTime() - duration), tz)
  const rangeFirstDay = Date.UTC(rangeFirst.year, rangeFirst.month - 1, rangeFirst.day) - 86_400_000
  const rangeLast = toWallTime(rangeEnd, tz)
  let lastDay = Date.UTC(rangeLast.year, rangeLast.month - 1, rangeLast.day)
  if (event.recurrence_until) {
    const [y, m, d] = event.recurrence_until.split('-').map(Number)
    lastDay = Math.min(lastDay, Date.UTC(y, m - 1, d))
  }

  const result: Occurrence[] = []
  for (let day = Math.max(firstDay, rangeFirstDay); day <= lastDay; day += 86_400_000) {
    const d = new Date(day)
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    const dom = d.getUTCDate()
    const jsDay = d.getUTCDay()
    const iso = jsDay === 0 ? 7 : jsDay

    let matches = false
    if (event.recurrence === 'daily') matches = true
    else if (event.recurrence === 'weekly') matches = weekdays.has(iso)
    else if (event.recurrence === 'monthly') {
      // On the 31st, months without a 31st use their last day.
      matches = dom === Math.min(first.day, daysInMonth(y, m))
    }
    if (!matches) continue

    const occStart = fromWallTime(y, m, dom, first.hour, first.minute, tz)
    if (occStart.getTime() < start.getTime()) continue
    const occEnd = new Date(occStart.getTime() + duration)
    if (overlaps(occStart, occEnd)) result.push({ start: occStart, end: occEnd })
    if (result.length >= MAX_OCCURRENCES) break
  }
  return result
}
