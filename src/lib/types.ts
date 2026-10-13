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
  created_by: string
  event_members: { member_id: string }[]
}

export interface Expense {
  id: string
  amount_cents: number
  category: Category
  spent_on: string
  paid_by: string | null
  note: string | null
}

export interface Allowance {
  id: string
  member_id: string
  amount_cents: number
  given_on: string
  note: string | null
}
