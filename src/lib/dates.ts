import { fromWallTime, toWallTime } from '../../supabase/functions/_shared/recurrence.ts'

export const WEEKDAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
const WEEKDAYS_LONG = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica']
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

const pad = (n: number) => String(n).padStart(2, '0')

/** Midnight (family time zone) of the Monday of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const w = toWallTime(date)
  const day = new Date(Date.UTC(w.year, w.month - 1, w.day - (w.weekday - 1)))
  return fromWallTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 0, 0)
}

/** Midnight (family time zone) `n` days after the midnight `date`. */
export function addDays(date: Date, n: number): Date {
  const w = toWallTime(date)
  const day = new Date(Date.UTC(w.year, w.month - 1, w.day + n))
  return fromWallTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), w.hour, w.minute)
}

export function formatTime(date: Date): string {
  const w = toWallTime(date)
  return `${pad(w.hour)}:${pad(w.minute)}`
}

export function formatDayTitle(date: Date): string {
  const w = toWallTime(date)
  return `${WEEKDAYS_LONG[w.weekday - 1]} ${w.day} ${MONTHS[w.month - 1]}`
}

export function formatWeekRange(start: Date): string {
  const a = toWallTime(start)
  const b = toWallTime(addDays(start, 6))
  return a.month === b.month
    ? `${a.day}–${b.day} ${MONTHS[a.month - 1]} ${a.year}`
    : `${a.day} ${MONTHS[a.month - 1]} – ${b.day} ${MONTHS[b.month - 1]} ${b.year}`
}

/** "YYYY-MM-DD" and "HH:MM" for <input type="date|time">. */
export function toInputs(date: Date): { date: string; time: string } {
  const w = toWallTime(date)
  return { date: `${w.year}-${pad(w.month)}-${pad(w.day)}`, time: `${pad(w.hour)}:${pad(w.minute)}` }
}

export function fromInputs(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  return fromWallTime(y, m, d, h, min)
}
