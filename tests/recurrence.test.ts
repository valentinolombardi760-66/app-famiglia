import { describe, expect, it } from 'vitest'
import { expandOccurrences, fromWallTime, toWallTime, type RecurringEvent } from '../supabase/functions/_shared/recurrence.ts'
import { dueReminders, type ReminderEvent } from '../supabase/functions/_shared/reminders.ts'

const rome = (y: number, m: number, d: number, h = 0, min = 0) => fromWallTime(y, m, d, h, min)
const hhmm = (date: Date) => {
  const w = toWallTime(date)
  return `${w.year}-${w.month}-${w.day} ${w.hour}:${String(w.minute).padStart(2, '0')}`
}

function event(partial: Partial<RecurringEvent> & { starts_at: string; ends_at: string }): RecurringEvent {
  return { recurrence: 'none', recurrence_weekdays: null, recurrence_until: null, ...partial }
}

describe('time zone conversion', () => {
  it('maps Rome wall time to UTC in winter and summer', () => {
    expect(rome(2026, 1, 15, 18, 0).toISOString()).toBe('2026-01-15T17:00:00.000Z')
    expect(rome(2026, 7, 15, 18, 0).toISOString()).toBe('2026-07-15T16:00:00.000Z')
  })

  it('round-trips through toWallTime', () => {
    const w = toWallTime(new Date('2026-10-25T09:30:00Z'))
    expect([w.year, w.month, w.day, w.hour, w.minute, w.weekday]).toEqual([2026, 10, 25, 10, 30, 7])
  })
})

describe('expandOccurrences', () => {
  it('returns a one-off event only when it overlaps the range', () => {
    const e = event({ starts_at: rome(2026, 10, 14, 17).toISOString(), ends_at: rome(2026, 10, 14, 18).toISOString() })
    expect(expandOccurrences(e, rome(2026, 10, 12), rome(2026, 10, 19))).toHaveLength(1)
    expect(expandOccurrences(e, rome(2026, 10, 19), rome(2026, 10, 26))).toHaveLength(0)
  })

  it('keeps the same local hour across the October DST change', () => {
    // Tuesday and Thursday training at 18:00, starting Tue 20 Oct 2026; DST ends Sun 25 Oct.
    const e = event({
      starts_at: rome(2026, 10, 20, 18).toISOString(),
      ends_at: rome(2026, 10, 20, 19, 30).toISOString(),
      recurrence: 'weekly',
      recurrence_weekdays: [2, 4],
    })
    const occ = expandOccurrences(e, rome(2026, 10, 19), rome(2026, 11, 2))
    expect(occ.map((o) => hhmm(o.start))).toEqual([
      '2026-10-20 18:00',
      '2026-10-22 18:00',
      '2026-10-27 18:00',
      '2026-10-29 18:00',
    ])
    expect(occ[2].start.toISOString()).toBe('2026-10-27T17:00:00.000Z')
    expect(occ[0].end.getTime() - occ[0].start.getTime()).toBe(90 * 60_000)
  })

  it('uses the start weekday when no weekdays are chosen', () => {
    const e = event({
      starts_at: rome(2026, 10, 14, 9).toISOString(),
      ends_at: rome(2026, 10, 14, 10).toISOString(),
      recurrence: 'weekly',
    })
    const occ = expandOccurrences(e, rome(2026, 10, 1), rome(2026, 11, 1))
    expect(occ.map((o) => toWallTime(o.start).day)).toEqual([14, 21, 28])
  })

  it('never returns occurrences before the first one', () => {
    const e = event({
      starts_at: rome(2026, 10, 15, 9).toISOString(),
      ends_at: rome(2026, 10, 15, 10).toISOString(),
      recurrence: 'daily',
    })
    const occ = expandOccurrences(e, rome(2026, 10, 12), rome(2026, 10, 18))
    expect(occ.map((o) => toWallTime(o.start).day)).toEqual([15, 16, 17])
  })

  it('stops at recurrence_until (inclusive)', () => {
    const e = event({
      starts_at: rome(2026, 10, 12, 7).toISOString(),
      ends_at: rome(2026, 10, 12, 8).toISOString(),
      recurrence: 'daily',
      recurrence_until: '2026-10-14',
    })
    const occ = expandOccurrences(e, rome(2026, 10, 1), rome(2026, 11, 1))
    expect(occ.map((o) => toWallTime(o.start).day)).toEqual([12, 13, 14])
  })

  it('moves monthly events on the 31st to the last day of shorter months', () => {
    const e = event({
      starts_at: rome(2026, 1, 31, 12).toISOString(),
      ends_at: rome(2026, 1, 31, 13).toISOString(),
      recurrence: 'monthly',
    })
    const occ = expandOccurrences(e, rome(2026, 1, 1), rome(2026, 5, 1))
    expect(occ.map((o) => `${toWallTime(o.start).month}/${toWallTime(o.start).day}`)).toEqual([
      '1/31',
      '2/28',
      '3/31',
      '4/30',
    ])
  })

  it('includes an occurrence that started before the range but is still running', () => {
    const e = event({
      starts_at: rome(2026, 10, 11, 22).toISOString(),
      ends_at: rome(2026, 10, 12, 2).toISOString(),
      recurrence: 'daily',
    })
    const occ = expandOccurrences(e, rome(2026, 10, 12, 0), rome(2026, 10, 13, 0))
    expect(occ.map((o) => hhmm(o.start))).toEqual(['2026-10-11 22:00', '2026-10-12 22:00'])
  })
})

describe('dueReminders', () => {
  const base: ReminderEvent = {
    id: 'e1',
    title: 'Dentista',
    all_day: false,
    location: 'Via Roma 1',
    starts_at: rome(2026, 10, 14, 16).toISOString(),
    ends_at: rome(2026, 10, 14, 17).toISOString(),
    recurrence: 'none',
    recurrence_weekdays: null,
    recurrence_until: null,
    reminder_minutes: [60],
    remind_evening_before: true,
  }

  it('fires the evening-before reminder at 20:00 the previous day', () => {
    const due = dueReminders([base], rome(2026, 10, 13, 19, 50), rome(2026, 10, 13, 20, 0))
    expect(due).toHaveLength(1)
    expect(due[0].body).toBe('Domani alle 16:00 · Via Roma 1')
    expect(due[0].key).toBe(`e1|${base.starts_at}|eve`)
  })

  it('fires the one-hour reminder and not outside its window', () => {
    expect(dueReminders([base], rome(2026, 10, 14, 14, 50), rome(2026, 10, 14, 15, 0))).toHaveLength(1)
    expect(dueReminders([base], rome(2026, 10, 14, 15, 0), rome(2026, 10, 14, 15, 10))).toHaveLength(0)
  })

  it('says "Domani" for a one-day-before reminder', () => {
    const e = { ...base, reminder_minutes: [1440], remind_evening_before: false }
    const due = dueReminders([e], rome(2026, 10, 13, 15, 55), rome(2026, 10, 13, 16, 0))
    expect(due.map((d) => d.body)).toEqual(['Domani alle 16:00 · Via Roma 1'])
  })

  it('reminds for each occurrence of a repeating event', () => {
    const e: ReminderEvent = {
      ...base,
      recurrence: 'weekly',
      recurrence_weekdays: [3],
      remind_evening_before: false,
    }
    const due = dueReminders([e], rome(2026, 10, 21, 14, 50), rome(2026, 10, 21, 15, 0))
    expect(due).toHaveLength(1)
    expect(due[0].occurrenceStart.toISOString()).toBe(rome(2026, 10, 21, 16).toISOString())
  })

  it('skips "minutes before" reminders for all-day events', () => {
    const e = { ...base, all_day: true, starts_at: rome(2026, 10, 14).toISOString(), ends_at: rome(2026, 10, 15).toISOString() }
    const due = dueReminders([e], rome(2026, 10, 13, 19, 55), rome(2026, 10, 13, 22, 59))
    expect(due.map((d) => d.body)).toEqual(['Domani, tutto il giorno · Via Roma 1'])
  })
})
