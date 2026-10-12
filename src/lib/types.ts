import type { Recurrence } from '../../supabase/functions/_shared/recurrence.ts'

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
