import { describe, expect, it } from 'vitest'
import { expandOccurrences, fromWallTime, type RecurringEvent } from '../supabase/functions/_shared/recurrence.ts'
import { dueReminders, type ReminderEvent } from '../supabase/functions/_shared/reminders.ts'
import { choreDueDates, dueChoreReminders, isArchived, type Chore } from '../supabase/functions/_shared/chores.ts'
import { conflictsFor, findConflicts, type Busy } from '../src/lib/conflicts.ts'
import { addDaysKey, weekStartKey } from '../src/lib/money.ts'

const rome = (y: number, m: number, d: number, h = 0, min = 0) => fromWallTime(y, m, d, h, min)

describe('skipped repetitions', () => {
  // Training every Tuesday and Thursday at 18:00 from Tue 3 Nov 2026.
  const training: RecurringEvent = {
    starts_at: rome(2026, 11, 3, 18).toISOString(),
    ends_at: rome(2026, 11, 3, 19, 30).toISOString(),
    recurrence: 'weekly',
    recurrence_weekdays: [2, 4],
    recurrence_until: null,
    skipped_dates: ['2026-11-26'],
  }

  it('leaves out a cancelled day and keeps the others', () => {
    const occ = expandOccurrences(training, rome(2026, 11, 23), rome(2026, 11, 30))
    expect(occ.map((o) => o.start.toISOString())).toEqual([rome(2026, 11, 24, 18).toISOString()])
  })

  it('sends no reminder for a cancelled day', () => {
    const event: ReminderEvent = {
      ...training,
      id: 'e1',
      title: 'Allenamento',
      all_day: false,
      location: null,
      reminder_minutes: [60],
      remind_evening_before: false,
    }
    const at = rome(2026, 11, 26, 17)
    expect(dueReminders([event], new Date(at.getTime() - 10 * 60_000), at)).toHaveLength(0)
    const tue = rome(2026, 11, 24, 17)
    expect(dueReminders([event], new Date(tue.getTime() - 10 * 60_000), tue)).toHaveLength(1)
  })

  it('treats a missing list like an empty one', () => {
    const occ = expandOccurrences({ ...training, skipped_dates: undefined }, rome(2026, 11, 23), rome(2026, 11, 30))
    expect(occ).toHaveLength(2)
  })
})

describe('chores with an end date', () => {
  const daily: Chore = {
    id: 'c1',
    title: 'Lavastoviglie',
    assigned_to: 's1',
    schedule: 'daily',
    weekdays: null,
    due_on: null,
    starts_on: '2026-11-01',
    ends_on: '2026-11-24',
  }

  it('stops counting after ends_on, but keeps the past', () => {
    expect(choreDueDates(daily, '2026-11-23', '2026-11-30')).toEqual(['2026-11-23', '2026-11-24'])
    expect(choreDueDates(daily, '2026-11-01', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02'])
  })

  it('is archived once ends_on is in the past', () => {
    expect(isArchived(daily, '2026-11-25')).toBe(true)
    expect(isArchived(daily, '2026-11-24')).toBe(false)
    expect(isArchived({ ...daily, ends_on: null }, '2030-01-01')).toBe(false)
  })

  it('sends no reminder after it ended', () => {
    const at = rome(2026, 11, 25, 19, 2)
    expect(dueChoreReminders([daily], new Set(), new Date(at.getTime() - 10 * 60_000), at)).toHaveLength(0)
    expect(dueChoreReminders([{ ...daily, ends_on: null }], new Set(), new Date(at.getTime() - 10 * 60_000), at)).toHaveLength(1)
  })

  it('hides a one-off chore whose deadline is after the end', () => {
    const once: Chore = { ...daily, schedule: 'once', due_on: '2026-11-28', ends_on: '2026-11-24' }
    expect(choreDueDates(once, '2026-11-23', '2026-11-30')).toEqual([])
  })
})

describe('overlaps', () => {
  const busy = (key: string, h1: number, m1: number, h2: number, m2: number, people: string[], extra: Partial<Busy> = {}): Busy => ({
    key,
    title: key,
    start: rome(2026, 11, 26, h1, m1),
    end: rome(2026, 11, 26, h2, m2),
    allDay: false,
    people,
    ...extra,
  })

  it('flags the same person in two places at once, on both items', () => {
    const map = findConflicts([busy('calcio', 17, 0, 18, 30, ['diego']), busy('dentista', 18, 0, 18, 30, ['diego'])])
    expect(map.get('calcio')?.map((c) => c.other.key)).toEqual(['dentista'])
    expect(map.get('dentista')?.map((c) => c.memberId)).toEqual(['diego'])
  })

  it('ignores back-to-back items and different people', () => {
    const map = findConflicts([
      busy('a', 17, 0, 18, 0, ['diego']),
      busy('b', 18, 0, 19, 0, ['diego']),
      busy('c', 17, 30, 18, 30, ['alessio']),
    ])
    expect(map.size).toBe(0)
  })

  it('catches the driver needed in two places', () => {
    const map = findConflicts([
      busy('calcio', 17, 0, 18, 30, ['diego', 'laura'], { driverId: 'laura' }),
      busy('nuoto', 17, 30, 18, 30, ['alessio', 'laura'], { driverId: 'laura' }),
    ])
    expect(map.get('calcio')).toEqual([expect.objectContaining({ memberId: 'laura', asDriver: true })])
  })

  it('ignores all-day items', () => {
    const map = findConflicts([busy('gita', 0, 0, 23, 59, ['diego'], { allDay: true }), busy('calcio', 17, 0, 18, 0, ['diego'])])
    expect(map.size).toBe(0)
  })

  it('gives a zero-length item its minute', () => {
    const map = findConflicts([busy('partenza', 7, 0, 7, 0, ['diego']), busy('colazione', 6, 30, 7, 30, ['diego'])])
    expect(map.size).toBe(2)
  })

  it('checks a draft against existing items, excluding itself', () => {
    const draft = busy('draft', 17, 0, 18, 0, ['diego'])
    expect(conflictsFor(draft, [busy('draft', 17, 0, 18, 0, ['diego']), busy('x', 17, 45, 19, 0, ['diego'])]).map((c) => c.other.key)).toEqual(['x'])
  })
})

describe('day keys after the refactor', () => {
  it('still finds Monday and adds days across months', () => {
    expect(weekStartKey('2026-11-29')).toBe('2026-11-23')
    expect(weekStartKey('2026-11-23')).toBe('2026-11-23')
    expect(addDaysKey('2026-11-30', 1)).toBe('2026-12-01')
  })
})
