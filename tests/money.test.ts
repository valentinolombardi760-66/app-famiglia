import { describe, expect, it } from 'vitest'
import {
  addDaysKey,
  allowanceTotals,
  allowancesFrom,
  formatEuro,
  monthStartKey,
  parseEuro,
  summarizeWeek,
  weekStartKey,
} from '../src/lib/money'

describe('parseEuro', () => {
  it('accepts the ways people type amounts', () => {
    expect(parseEuro('12')).toBe(1200)
    expect(parseEuro('12,5')).toBe(1250)
    expect(parseEuro('12.50')).toBe(1250)
    expect(parseEuro('1.234,56')).toBe(123456)
    expect(parseEuro(' € 3,99 ')).toBe(399)
    expect(parseEuro('0,10')).toBe(10)
  })

  it('rejects anything else', () => {
    for (const bad of ['', '0', '0,00', '-5', 'dieci', '1,234', '12,345', '12.3.4', '100000,01']) {
      expect(parseEuro(bad), bad).toBeNull()
    }
  })
})

describe('formatEuro', () => {
  it('uses the Italian format', () => {
    expect(formatEuro(1234567).replace(/\s/g, ' ')).toBe('12.345,67 €')
    expect(formatEuro(1250).replace(/\s/g, ' ')).toBe('12,50 €')
  })
})

describe('weeks and months', () => {
  it('starts weeks on Monday', () => {
    expect(weekStartKey('2026-10-13')).toBe('2026-10-12') // Tuesday
    expect(weekStartKey('2026-10-12')).toBe('2026-10-12') // Monday
    expect(weekStartKey('2026-10-18')).toBe('2026-10-12') // Sunday
    expect(weekStartKey('2026-11-01')).toBe('2026-10-26') // across months
  })

  it('is not affected by daylight saving time', () => {
    expect(addDaysKey('2026-10-25', 1)).toBe('2026-10-26')
    expect(addDaysKey('2026-03-29', -1)).toBe('2026-03-28')
  })

  it('finds the first day of the month', () => {
    expect(monthStartKey('2026-10-13')).toBe('2026-10-01')
  })
})

describe('summarizeWeek', () => {
  const expenses = [
    { amount_cents: 5000, category: 'spesa' as const, spent_on: '2026-10-12' },
    { amount_cents: 2000, category: 'auto' as const, spent_on: '2026-10-18' },
    { amount_cents: 1000, category: 'spesa' as const, spent_on: '2026-10-14' },
    { amount_cents: 7000, category: 'bollette' as const, spent_on: '2026-10-11' }, // previous week
    { amount_cents: 9999, category: 'svago' as const, spent_on: '2026-10-19' }, // next week
  ]

  it('adds up the week and the week before', () => {
    const s = summarizeWeek(expenses, '2026-10-12')
    expect(s.total).toBe(8000)
    expect(s.previousTotal).toBe(7000)
  })

  it('splits by category, largest first', () => {
    expect(summarizeWeek(expenses, '2026-10-12').byCategory).toEqual([
      { category: 'spesa', total: 6000 },
      { category: 'auto', total: 2000 },
    ])
  })
})

describe('allowanceTotals', () => {
  it('counts this week and this month per son', () => {
    const totals = allowanceTotals(
      [
        { member_id: 'diego', amount_cents: 1000, given_on: '2026-10-12' },
        { member_id: 'diego', amount_cents: 500, given_on: '2026-10-05' },
        { member_id: 'diego', amount_cents: 300, given_on: '2026-09-30' },
        { member_id: 'alessio', amount_cents: 700, given_on: '2026-10-13' },
        { member_id: 'alessio', amount_cents: 900, given_on: '2026-10-20' }, // future, ignored
      ],
      '2026-10-13',
    )
    expect(totals.get('diego')).toEqual({ week: 1000, month: 1500 })
    expect(totals.get('alessio')).toEqual({ week: 700, month: 700 })
  })

  it('handles a week that starts in the previous month', () => {
    const totals = allowanceTotals(
      [
        { member_id: 'diego', amount_cents: 400, given_on: '2026-09-28' },
        { member_id: 'diego', amount_cents: 600, given_on: '2026-10-01' },
      ],
      '2026-10-02',
    )
    expect(totals.get('diego')).toEqual({ week: 1000, month: 600 })
    expect(allowancesFrom('2026-10-02')).toBe('2026-09-28')
  })
})
