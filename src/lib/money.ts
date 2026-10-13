// Money and week arithmetic for expenses and pocket money.
// Amounts are integer cents; days are "YYYY-MM-DD" keys in the family's time zone.

export const CATEGORIES = [
  { key: 'spesa', label: 'Spesa alimentare', icon: '🛒' },
  { key: 'bollette', label: 'Bollette', icon: '💡' },
  { key: 'auto', label: 'Auto', icon: '🚗' },
  { key: 'scuola', label: 'Scuola', icon: '🎒' },
  { key: 'svago', label: 'Svago', icon: '🎉' },
  { key: 'altro', label: 'Altro', icon: '📦' },
] as const

export type Category = (typeof CATEGORIES)[number]['key']

export const MAX_EURO = 100_000

const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })

export function formatEuro(cents: number): string {
  return euro.format(cents / 100)
}

/** "12", "12,5", "12.50", "1.234,56", "€ 3" → cents; null if not a valid positive amount. */
export function parseEuro(text: string): number | null {
  let s = text.replace(/[€\s]/g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const cents = Math.round(Number(s) * 100)
  return cents > 0 && cents <= MAX_EURO * 100 ? cents : null
}

function keyToUtc(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function utcToKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDaysKey(key: string, n: number): string {
  const d = keyToUtc(key)
  d.setUTCDate(d.getUTCDate() + n)
  return utcToKey(d)
}

/** Monday of the week containing `key`. */
export function weekStartKey(key: string): string {
  const weekday = (keyToUtc(key).getUTCDay() + 6) % 7 // 0 = Monday
  return addDaysKey(key, -weekday)
}

export function monthStartKey(key: string): string {
  return `${key.slice(0, 7)}-01`
}

/** True when from <= key < to. */
export function inRange(key: string, from: string, to: string): boolean {
  return key >= from && key < to
}

export interface ExpenseLike {
  amount_cents: number
  category: Category
  spent_on: string
}

export interface WeekSummary {
  total: number
  previousTotal: number
  byCategory: { category: Category; total: number }[]
}

/** Totals for the week starting `weekStart`, compared with the week before. */
export function summarizeWeek(expenses: ExpenseLike[], weekStart: string): WeekSummary {
  const weekEnd = addDaysKey(weekStart, 7)
  const previousStart = addDaysKey(weekStart, -7)
  const sums = new Map<Category, number>()
  let total = 0
  let previousTotal = 0
  for (const e of expenses) {
    if (inRange(e.spent_on, weekStart, weekEnd)) {
      total += e.amount_cents
      sums.set(e.category, (sums.get(e.category) ?? 0) + e.amount_cents)
    } else if (inRange(e.spent_on, previousStart, weekStart)) {
      previousTotal += e.amount_cents
    }
  }
  const byCategory = [...sums].map(([category, t]) => ({ category, total: t })).sort((a, b) => b.total - a.total)
  return { total, previousTotal, byCategory }
}

export interface AllowanceLike {
  member_id: string
  amount_cents: number
  given_on: string
}

/** Pocket money received this week and this month, per son. */
export function allowanceTotals(allowances: AllowanceLike[], today: string): Map<string, { week: number; month: number }> {
  const weekStart = weekStartKey(today)
  const monthStart = monthStartKey(today)
  const totals = new Map<string, { week: number; month: number }>()
  for (const a of allowances) {
    if (a.given_on > today) continue
    const t = totals.get(a.member_id) ?? { week: 0, month: 0 }
    if (a.given_on >= weekStart) t.week += a.amount_cents
    if (a.given_on >= monthStart) t.month += a.amount_cents
    totals.set(a.member_id, t)
  }
  return totals
}

/** Earliest day the pocket-money totals for `today` need. */
export function allowancesFrom(today: string): string {
  const w = weekStartKey(today)
  const m = monthStartKey(today)
  return w < m ? w : m
}
