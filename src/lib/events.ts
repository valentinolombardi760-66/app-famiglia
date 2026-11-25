// Loading calendar events and turning them into dated occurrences.
// Kept apart from the pages so the calendar, the "Oggi" screen and the form's
// overlap check all read events the same way.

import { supabase } from './supabase'
import type { CalendarEvent, EventKind } from './types'
import { expandOccurrences, toDateKey } from '../../supabase/functions/_shared/recurrence.ts'

export const EVENT_COLUMNS =
  'id, title, starts_at, ends_at, all_day, location, notes, recurrence, recurrence_weekdays, recurrence_until, skipped_dates, reminder_minutes, remind_evening_before, kind, bring, driver_id, created_by, event_members(member_id)'

/** One dated appearance of an event: a one-off, or one repetition of a series. */
export interface Occurrence {
  event: CalendarEvent
  start: Date
  end: Date
  /** Stable per occurrence: event id + start. */
  key: string
}

/** Events that may have an occurrence in [from, to); null if loading failed. */
export async function loadEvents(from: Date, to: Date): Promise<CalendarEvent[] | null> {
  const fromDay = toDateKey(from)
  const [oneOff, repeating] = await Promise.all([
    supabase.from('events').select(EVENT_COLUMNS).eq('recurrence', 'none').lt('starts_at', to.toISOString()).gte('ends_at', from.toISOString()),
    supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .neq('recurrence', 'none')
      .lt('starts_at', to.toISOString())
      .or(`recurrence_until.is.null,recurrence_until.gte.${fromDay}`),
  ])
  if (oneOff.error || repeating.error) return null
  return [...(oneOff.data ?? []), ...(repeating.data ?? [])].map(normalize)
}

/** Fills defaults so rows saved before a column existed still work. */
function normalize(row: unknown): CalendarEvent {
  const e = row as CalendarEvent
  return {
    ...e,
    skipped_dates: e.skipped_dates ?? [],
    kind: (e.kind ?? 'impegno') as EventKind,
    bring: e.bring ?? null,
    driver_id: e.driver_id ?? null,
    event_members: e.event_members ?? [],
  }
}

/** All occurrences in [from, to), in time order (all-day ones first on a tie). */
export function occurrencesIn(events: CalendarEvent[], from: Date, to: Date): Occurrence[] {
  const out: Occurrence[] = []
  for (const event of events) {
    for (const occ of expandOccurrences(event, from, to)) {
      out.push({ event, start: occ.start, end: occ.end, key: `${event.id}|${occ.start.toISOString()}` })
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.event.all_day) - Number(a.event.all_day))
}

/** Occurrences that touch the day [dayStart, dayEnd). */
export function onDay(items: Occurrence[], dayStart: Date, dayEnd: Date): Occurrence[] {
  return items.filter((it) => it.start < dayEnd && (it.end > dayStart || it.start >= dayStart))
}

/** Member ids an event concerns: its people (everyone if none) plus whoever drives. */
export function peopleOf(event: CalendarEvent, allMemberIds: string[]): string[] {
  const people = event.event_members.length === 0 ? [...allMemberIds] : event.event_members.map((m) => m.member_id)
  if (event.driver_id && !people.includes(event.driver_id)) people.push(event.driver_id)
  return people
}

/** True when the event concerns the member (as participant, whole family, or driver). */
export function concerns(event: CalendarEvent, memberId: string): boolean {
  return (
    event.event_members.length === 0 ||
    event.event_members.some((m) => m.member_id === memberId) ||
    event.driver_id === memberId
  )
}
