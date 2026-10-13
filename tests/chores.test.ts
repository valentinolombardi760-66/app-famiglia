import { describe, expect, it } from 'vitest'
import {
  choreDueDates,
  completionKey,
  dueChoreReminders,
  weekdayOfKey,
  type Chore,
} from '../supabase/functions/_shared/chores'

const base: Chore = {
  id: 'c1',
  title: 'Lavastoviglie',
  assigned_to: 'diego',
  schedule: 'daily',
  weekdays: null,
  due_on: null,
  starts_on: '2026-10-01',
}

describe('choreDueDates', () => {
  const week = ['2026-10-12', '2026-10-19'] as const // Monday to next Monday

  it('daily chores are due every day from their first day', () => {
    expect(choreDueDates(base, ...week)).toHaveLength(7)
    expect(choreDueDates({ ...base, starts_on: '2026-10-16' }, ...week)).toEqual(['2026-10-16', '2026-10-17', '2026-10-18'])
  })

  it('"days" chores only on their weekdays', () => {
    expect(choreDueDates({ ...base, schedule: 'days', weekdays: [1, 3, 5] }, ...week)).toEqual([
      '2026-10-12',
      '2026-10-14',
      '2026-10-16',
    ])
  })

  it('weekly chores are due once, on their deadline day', () => {
    expect(choreDueDates({ ...base, schedule: 'weekly', weekdays: [7] }, ...week)).toEqual(['2026-10-18'])
  })

  it('one-off chores only on their due date', () => {
    const once = { ...base, schedule: 'once' as const, due_on: '2026-10-15', starts_on: '2026-10-20' }
    expect(choreDueDates(once, ...week)).toEqual(['2026-10-15'])
    expect(choreDueDates(once, '2026-10-19', '2026-10-26')).toEqual([])
  })

  it('knows the weekday of a day', () => {
    expect(weekdayOfKey('2026-10-12')).toBe(1)
    expect(weekdayOfKey('2026-10-18')).toBe(7)
  })
})

describe('dueChoreReminders', () => {
  // 19:00 in Rome on 13 October 2026 is 17:00 UTC (summer time).
  const at = (iso: string) => new Date(iso)
  const window = (nowIso: string) => [new Date(at(nowIso).getTime() - 15 * 60_000), at(nowIso)] as const

  it('reminds at 19:00 on the due day', () => {
    const due = dueChoreReminders([base], new Set(), ...window('2026-10-13T17:02:00Z'))
    expect(due).toEqual([
      expect.objectContaining({ key: 'chore|c1|2026-10-13', assignedTo: 'diego', title: '🧹 Lavastoviglie' }),
    ])
  })

  it('stays quiet before 19:00 and long after it', () => {
    expect(dueChoreReminders([base], new Set(), ...window('2026-10-13T16:59:00Z'))).toEqual([])
    expect(dueChoreReminders([base], new Set(), ...window('2026-10-13T17:20:00Z'))).toEqual([])
  })

  it('skips chores already ticked', () => {
    const done = new Set([completionKey('c1', '2026-10-13')])
    expect(dueChoreReminders([base], done, ...window('2026-10-13T17:02:00Z'))).toEqual([])
  })

  it('skips chores not due that day', () => {
    const mondays = { ...base, schedule: 'days' as const, weekdays: [1] }
    expect(dueChoreReminders([mondays], new Set(), ...window('2026-10-13T17:02:00Z'))).toEqual([])
  })

  it('follows winter time', () => {
    // 19:00 in Rome on 2 November 2026 is 18:00 UTC.
    expect(dueChoreReminders([base], new Set(), ...window('2026-11-02T17:02:00Z'))).toEqual([])
    expect(dueChoreReminders([base], new Set(), ...window('2026-11-02T18:02:00Z'))).toHaveLength(1)
  })
})
