import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Allowance, Expense, Member } from '../lib/types'
import { toDateKey } from '../../supabase/functions/_shared/recurrence.ts'
import { formatDayKey, formatMonthKey, formatWeekRangeKey } from '../lib/dates'
import {
  CATEGORIES,
  addDaysKey,
  allowanceTotals,
  allowancesFrom,
  formatEuro,
  summarizeWeek,
  weekStartKey,
} from '../lib/money'
import { PaghettaForm, SpesaForm } from './MoneyForms'

const CATEGORY = new Map(CATEGORIES.map((c) => [c.key, c]))
// Pocket money history shown to parents.
const HISTORY_DAYS = 60

type View = 'spese' | 'paghette'

/** Household expenses and pocket money, for parents. */
export function Spese({ me, members }: { me: Member; members: Member[] }) {
  const [view, setView] = useState<View>('spese')
  const [formOpen, setFormOpen] = useState(false)
  return (
    <section>
      <header className="cal-header" hidden={formOpen}>
        <h1>{view === 'spese' ? 'Spese' : 'Paghette'}</h1>
        <div className="segmented" role="group" aria-label="Sezione">
          <button className={view === 'spese' ? 'on' : ''} onClick={() => setView('spese')}>
            Spese
          </button>
          <button className={view === 'paghette' ? 'on' : ''} onClick={() => setView('paghette')}>
            Paghette
          </button>
        </div>
      </header>
      {view === 'spese' ? (
        <SpeseSettimana me={me} members={members} onForm={setFormOpen} />
      ) : (
        <Paghette me={me} members={members} onForm={setFormOpen} />
      )}
    </section>
  )
}

function SpeseSettimana({ me, members, onForm }: { me: Member; members: Member[]; onForm: (open: boolean) => void }) {
  const today = toDateKey(new Date())
  const [weekStart, setWeekStart] = useState(() => weekStartKey(today))
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Expense | 'new' | null>(null)
  useEffect(() => onForm(editing !== null), [editing, onForm])

  const weekEnd = addDaysKey(weekStart, 7)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('expenses')
      .select('id, amount_cents, category, spent_on, paid_by, note')
      .gte('spent_on', addDaysKey(weekStart, -7))
      .lt('spent_on', addDaysKey(weekStart, 7))
      .order('spent_on', { ascending: false })
      .order('created_at', { ascending: false })
    setLoading(false)
    if (error) return setError('Impossibile caricare le spese. Controlla la connessione.')
    setError(null)
    setExpenses(data as Expense[])
  }, [weekStart])

  useEffect(() => {
    void load()
  }, [load])

  const summary = useMemo(() => summarizeWeek(expenses, weekStart), [expenses, weekStart])
  const thisWeek = expenses.filter((e) => e.spent_on >= weekStart && e.spent_on < weekEnd)
  const byId = new Map(members.map((m) => [m.id, m]))

  if (editing) {
    return (
      <SpesaForm
        me={me}
        members={members}
        expense={editing === 'new' ? null : editing}
        today={today}
        onClose={(changed) => {
          setEditing(null)
          if (changed) void load()
        }}
      />
    )
  }

  const diff = summary.total - summary.previousTotal
  const largest = summary.byCategory[0]?.total ?? 0

  return (
    <>
      <div className="week-nav">
        <button className="icon" aria-label="Settimana precedente" onClick={() => setWeekStart(addDaysKey(weekStart, -7))}>
          ‹
        </button>
        <button className="link" onClick={() => setWeekStart(weekStartKey(today))}>
          {formatWeekRangeKey(weekStart)}
        </button>
        <button
          className="icon"
          aria-label="Settimana successiva"
          disabled={weekEnd > today}
          onClick={() => setWeekStart(addDaysKey(weekStart, 7))}
        >
          ›
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card summary">
        <p className="muted small">Totale della settimana</p>
        <p className="big">{formatEuro(summary.total)}</p>
        <p className="small">
          {summary.previousTotal === 0 && summary.total === 0
            ? 'Nessuna spesa né questa settimana né la precedente.'
            : diff === 0
              ? 'Uguale alla settimana prima.'
              : `${formatEuro(Math.abs(diff))} ${diff > 0 ? 'in più' : 'in meno'} della settimana prima (${formatEuro(summary.previousTotal)}).`}
        </p>
        {summary.byCategory.length > 0 && (
          <ul className="bars">
            {summary.byCategory.map(({ category, total }) => (
              <li key={category}>
                <span>
                  {CATEGORY.get(category)?.icon} {CATEGORY.get(category)?.label}
                </span>
                <span className="amount">{formatEuro(total)}</span>
                <span className="bar" style={{ width: `${Math.max(4, (total / largest) * 100)}%` }} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {loading && expenses.length === 0 && <p className="muted">Caricamento…</p>}
      {!loading && thisWeek.length === 0 && <p className="muted">Nessuna spesa in questa settimana. Aggiungila con +.</p>}
      <ul className="money-list">
        {thisWeek.map((e) => (
          <li key={e.id}>
            <button className="money-item" onClick={() => setEditing(e)}>
              <span className="icon-cell" aria-hidden>
                {CATEGORY.get(e.category)?.icon}
              </span>
              <span>
                <strong>{e.note || CATEGORY.get(e.category)?.label}</strong>
                <span className="muted small">
                  {formatDayKey(e.spent_on)}
                  {e.paid_by && byId.get(e.paid_by) ? ` · ${byId.get(e.paid_by)!.name}` : ''}
                </span>
              </span>
              <span className="amount">{formatEuro(e.amount_cents)}</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="fab" aria-label="Nuova spesa" onClick={() => setEditing('new')}>
        +
      </button>
    </>
  )
}

function Paghette({ me, members, onForm }: { me: Member; members: Member[]; onForm: (open: boolean) => void }) {
  const today = toDateKey(new Date())
  const sons = members.filter((m) => m.role === 'figlio')
  const [allowances, setAllowances] = useState<Allowance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Allowance | 'new' | null>(null)
  useEffect(() => onForm(editing !== null), [editing, onForm])

  const load = useCallback(async () => {
    setLoading(true)
    const historyStart = addDaysKey(today, -HISTORY_DAYS)
    const from = [historyStart, allowancesFrom(today)].sort()[0]
    const { data, error } = await supabase
      .from('allowances')
      .select('id, member_id, amount_cents, given_on, note')
      .gte('given_on', from)
      .order('given_on', { ascending: false })
      .order('created_at', { ascending: false })
    setLoading(false)
    if (error) return setError('Impossibile caricare le paghette. Controlla la connessione.')
    setError(null)
    setAllowances(data as Allowance[])
  }, [today])

  useEffect(() => {
    void load()
  }, [load])

  if (editing) {
    return (
      <PaghettaForm
        me={me}
        sons={sons}
        allowance={editing === 'new' ? null : editing}
        today={today}
        onClose={(changed) => {
          setEditing(null)
          if (changed) void load()
        }}
      />
    )
  }

  const totals = allowanceTotals(allowances, today)
  const byId = new Map(members.map((m) => [m.id, m]))

  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="card spaced">
        <ul className="totals">
          <li className="muted small">
            <span />
            <span>Questa settimana</span>
            <span>{formatMonthKey(today)}</span>
          </li>
          {sons.map((s) => (
            <li key={s.id}>
              <strong style={{ color: s.color }}>{s.name}</strong>
              <span className="amount">{formatEuro(totals.get(s.id)?.week ?? 0)}</span>
              <span className="amount">{formatEuro(totals.get(s.id)?.month ?? 0)}</span>
            </li>
          ))}
        </ul>
        {sons.length === 0 && <p className="muted small">Aggiungi i figli da Impostazioni › Famiglia.</p>}
      </div>
      <h2>Ultimi {HISTORY_DAYS} giorni</h2>
      {loading && allowances.length === 0 && <p className="muted">Caricamento…</p>}
      {!loading && allowances.length === 0 && <p className="muted">Nessuna paghetta registrata. Aggiungila con +.</p>}
      <ul className="money-list">
        {allowances.map((a) => {
          const son = byId.get(a.member_id)
          return (
            <li key={a.id}>
              <button className="money-item" onClick={() => setEditing(a)}>
                <span className="icon-cell" aria-hidden>
                  💶
                </span>
                <span>
                  <strong style={son ? { color: son.color } : undefined}>{son?.name ?? '—'}</strong>
                  <span className="muted small">
                    {formatDayKey(a.given_on)}
                    {a.note ? ` · ${a.note}` : ''}
                  </span>
                </span>
                <span className="amount">{formatEuro(a.amount_cents)}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <button className="fab" aria-label="Nuova paghetta" onClick={() => setEditing('new')}>
        +
      </button>
    </>
  )
}

/** A son's own pocket money (the database only returns his rows). */
export function MiaPaghetta({ me }: { me: Member }) {
  const today = toDateKey(new Date())
  const [allowances, setAllowances] = useState<Allowance[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void supabase
      .from('allowances')
      .select('id, member_id, amount_cents, given_on, note')
      .eq('member_id', me.id)
      .order('given_on', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) setError('Impossibile caricare la paghetta. Controlla la connessione.')
        else setAllowances(data as Allowance[])
      })
  }, [me.id])

  const totals = allowanceTotals(allowances ?? [], today).get(me.id) ?? { week: 0, month: 0 }

  return (
    <section className="stack">
      <h1>La mia paghetta</h1>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <div className="card summary">
          <p className="muted small">Questa settimana</p>
          <p className="big">{formatEuro(totals.week)}</p>
        </div>
        <div className="card summary">
          <p className="muted small">{formatMonthKey(today)}</p>
          <p className="big">{formatEuro(totals.month)}</p>
        </div>
      </div>
      {allowances === null && !error && <p className="muted">Caricamento…</p>}
      {allowances?.length === 0 && <p className="muted">Ancora nessuna paghetta registrata.</p>}
      <ul className="money-list">
        {allowances?.map((a) => (
          <li key={a.id} className="money-item static">
            <span className="icon-cell" aria-hidden>
              💶
            </span>
            <span>
              <strong>{formatDayKey(a.given_on)}</strong>
              {a.note && <span className="muted small">{a.note}</span>}
            </span>
            <span className="amount">{formatEuro(a.amount_cents)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
