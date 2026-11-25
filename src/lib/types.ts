import type { Recurrence } from '../../supabase/functions/_shared/recurrence.ts'
import type { Category } from './money'

export type Role = 'genitore' | 'figlio'

export interface Member {
  id: string
  email: string
  name: string
  role: Role
  color: string
}

export interface CalendarEvent {
  id: string
  title: string
  starts_at: string
  ends_at: string
  all_day: boolean
  location: string | null
  notes: string | null
  recurrence: Recurrence
  recurrence_weekdays: number[] | null
  recurrence_until: string | null
  reminder_minutes: number[]
  remind_evening_before: boolean
  skipped_dates: string[]
  kind: EventKind
  bring: string | null
  driver_id: string | null
  /** Null when whoever created it is no longer in the family. */
  created_by: string | null
  event_members: { member_id: string }[]
}

export type EventKind = 'impegno' | 'sport' | 'visita' | 'scuola'

export const EVENT_KINDS: { key: EventKind; label: string; icon: string }[] = [
  { key: 'impegno', label: 'Impegno', icon: '📌' },
  { key: 'sport', label: 'Sport', icon: '⚽' },
  { key: 'visita', label: 'Visita', icon: '🩺' },
  { key: 'scuola', label: 'Scuola', icon: '🎒' },
]

export interface Expense {
  id: string
  amount_cents: number
  category: Category
  spent_on: string
  note: string | null
}

export interface Allowance {
  id: string
  member_id: string
  amount_cents: number
  given_on: string
  note: string | null
}

export type { Chore, ChoreSchedule } from '../../supabase/functions/_shared/chores.ts'

export interface ChoreCompletion {
  chore_id: string
  due_on: string
}
