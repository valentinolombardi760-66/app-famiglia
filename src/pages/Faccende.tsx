import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Chore, ChoreCompletion, Member } from '../lib/types'
import { toDateKey } from '../../supabase/functions/_shared/recurrence.ts'
import { CHORE_REMINDER_HOUR, choreDueDates, completionKey } from '../../supabase/functions/_shared/chores.ts'
import { WEEKDAYS_SHORT, formatDayKey, formatWeekRangeKey } from '../lib/dates'
import { addDaysKey, weekStartKey } from '../lib/money'
import { ChoreForm } from './ChoreForm'

const CHORE_COLUMNS = 'id, title, assigned_to, schedule, weekdays, due_on, starts_on'
const WEEKDAYS_LONG = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica']
// How far back a son still sees deadlines he missed. Missed daily chores aren't
// carried over (yesterday's dishes are gone): parents see them as ✗ instead.
const LATE_DAYS = { once: 30, weekly: 7 }

export function describeSchedule(c: Chore): string {
  const days = c.weekdays ?? []
  switch (c.schedule) {
    case 'daily':
      return 'Ogni giorno'
    case 'days':
      return days.map((d) => WEEKDAYS_SHORT[d - 1]).join(', ')
    case 'weekly':
      return `Una volta a settimana, entro ${WEEKDAYS_LONG[days[0] - 1]}`
    case 'once':
      return `Una volta, entro ${formatDayKey(c.due_on!)}`
  }
}

async function loadChores(from: string, to: string) {
  const [chores, completions] = await Promise.all([
    supabase.from('chores').select(CHORE_COLUMNS).order('created_at'),
    supabase.from('chore_completions').select('chore_id, due_on').gte('due_on', from).lt('due_on', to),
  ])
  if (chores.error || completions.error) return null
  return {
    chores: chores.data as Chore[],
    done: new Set((completions.data as ChoreCompletion[]).map((c) => completionKey(c.chore_id, c.due_on))),
  }
}

/** Ticks or unticks one occurrence; returns false if it failed. */
async function setDone(me: Member, chore: Chore, day: string, done: boolean): Promise<boolean> {
  const { error } = done
    ? await supabase.from('chore_completions').insert({ chore_id: chore.id, due_on: day, done_by: me.id })
    : await supabase.from('chore_completions').delete().eq('chore_id', chore.id).eq('due_on', day)
  // Already ticked from another phone: same end result.
  return !error || error.code === '23505'
}

function useChores(from: string, to: string) {
  const [chores, setChores] = useState<Chore[] | null>(null)
  const [done, setDoneSet] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await loadChores(from, to)
    if (!result) return setError('Impossibile caricare le faccende. Controlla la connessione.')
    setError(null)
    setChores(result.chores)
    setDoneSet(result.done)
  }, [from, to])

  useEffect(() => {
    void load()
  }, [load])

  // Optimistic: flip it right away, put it back if the database says no.
  const toggle = useCallback(async (me: Member, chore: Chore, day: string, wasDone: boolean) => {
    const key = completionKey(chore.id, day)
    setDoneSet((prev) => {
      const next = new Set(prev)
      if (wasDone) next.delete(key)
      else next.add(key)
      return next
    })
    if (!(await setDone(me, chore, day, !wasDone))) {
      setError('Non è stato possibile salvare. Controlla la connessione e riprova.')
      void load()
    }
  }, [load])

  return { chores, done, error, load, toggle }
}

/** Parents: the week's chores of every son, with what was done. */
export function Faccende({ me, members }: { me: Member; members: Member[] }) {
  const today = toDateKey(new Date())
  const [weekStart, setWeekStart] = useState(() => weekStartKey(today))
  const weekEnd = addDaysKey(weekStart, 7)
  const { chores, done, error, load, toggle } = useChores(weekStart, weekEnd)
  const [editing, setEditing] = useState<Chore | 'new' | null>(null)
  const sons = members.filter((m) => m.role === 'figlio')

  if (editing) {
    return (
      <ChoreForm
        me={me}
        sons={sons}
        chore={editing === 'new' ? null : editing}
        today={today}
        onClose={(changed) => {
          setEditing(null)
          if (changed) void load()
        }}
      />
    )
  }

  const days = Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i))

  return (
    <section>
      <h1>Faccende</h1>
      <div className="week-nav">
        <button className="icon" aria-label="Settimana precedente" onClick={() => setWeekStart(addDaysKey(weekStart, -7))}>
          ‹
        </button>
        <button className="link" onClick={() => setWeekStart(weekStartKey(today))}>
          {formatWeekRangeKey(weekStart)}
        </button>
        <button className="icon" aria-label="Settimana successiva" onClick={() => setWeekStart(weekEnd)}>
          ›
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {chores === null && !error && <p className="muted">Caricamento…</p>}
      {sons.length === 0 && <p className="muted">Aggiungi i figli da Impostazioni › Famiglia.</p>}
      {chores?.length === 0 && sons.length > 0 && (
        <p className="muted">Nessuna faccenda ancora. Aggiungila con +.</p>
      )}
      <div className="stack">
        {chores &&
          chores.length > 0 &&
          sons.map((son) => {
            // One-off chores show up in the week they're due; recurring ones every week they apply.
            const mine = chores.filter(
              (c) =>
                c.assigned_to === son.id &&
                (c.schedule === 'once' ? choreDueDates(c, weekStart, weekEnd).length > 0 : c.starts_on < weekEnd),
            )
            const dueCount = mine.reduce((n, c) => n + choreDueDates(c, weekStart, weekEnd).length, 0)
            const doneCount = mine.reduce(
              (n, c) => n + choreDueDates(c, weekStart, weekEnd).filter((d) => done.has(completionKey(c.id, d))).length,
              0,
            )
            return (
              <div className="card" key={son.id}>
                <div className="son-head">
                  <h2 style={{ color: son.color }}>{son.name}</h2>
                  {dueCount > 0 && (
                    <span className="muted small">
                      {doneCount} di {dueCount} fatte
                    </span>
                  )}
                </div>
                {mine.length === 0 ? (
                  <p className="muted small">Niente questa settimana.</p>
                ) : (
                  <>
                    <div className="cells head" aria-hidden>
                      {WEEKDAYS_SHORT.map((d) => (
                        <span key={d}>{d}</span>
                      ))}
                    </div>
                    <ul className="chore-grid">
                      {mine.map((c) => {
                        const due = new Set(choreDueDates(c, weekStart, weekEnd))
                        return (
                          <li key={c.id}>
                            <button className="chore-name" onClick={() => setEditing(c)}>
                              {c.title}
                              <span className="muted small">{describeSchedule(c)}</span>
                            </button>
                            <div className="cells">
                              {days.map((d) => {
                                if (!due.has(d)) return <span key={d} className="cell none" />
                                const isDone = done.has(completionKey(c.id, d))
                                const cls = isDone ? 'done' : d < today ? 'missed' : d === today ? 'today' : ''
                                return (
                                  <button
                                    key={d}
                                    className={`cell ${cls}`}
                                    aria-pressed={isDone}
                                    aria-label={`${c.title}, ${formatDayKey(d)}: ${isDone ? 'fatta' : d < today ? 'non fatta' : 'da fare'}`}
                                    onClick={() => void toggle(me, c, d, isDone)}
                                  >
                                    {isDone ? '✓' : d < today ? '✗' : ''}
                                  </button>
                                )
                              })}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
              </div>
            )
          })}
      </div>
      {chores && chores.length > 0 && (
        <p className="muted small spaced fab-clear">
          Tocca un giorno per segnarlo come fatto, tocca il nome per modificare la faccenda.
        </p>
      )}
      {sons.length > 0 && (
        <button className="fab" aria-label="Nuova faccenda" onClick={() => setEditing('new')}>
          +
        </button>
      )}
    </section>
  )
}

interface Todo {
  chore: Chore
  day: string
}

/** A son's own chores: what's late, what's for today, what's coming. */
export function MieFaccende({ me }: { me: Member }) {
  const today = toDateKey(new Date())
  const from = addDaysKey(today, -LATE_DAYS.once)
  const to = addDaysKey(today, 7)
  const { chores, done, error, toggle } = useChores(from, to)

  const late: Todo[] = []
  const todays: Todo[] = []
  const coming: Todo[] = []
  for (const chore of chores ?? []) {
    for (const day of choreDueDates(chore, from, to)) {
      const todo = { chore, day }
      if (day === today) todays.push(todo)
      else if (day < today) {
        const lateFrom =
          chore.schedule === 'once' ? from : chore.schedule === 'weekly' ? addDaysKey(today, -LATE_DAYS.weekly) : today
        if (day >= lateFrom && !done.has(completionKey(chore.id, day))) late.push(todo)
      } else if (chore.schedule === 'weekly' || chore.schedule === 'once') {
        // Daily chores would just repeat; deadlines are worth seeing ahead.
        coming.push(todo)
      }
    }
  }
  const byDay = (a: Todo, b: Todo) => a.day.localeCompare(b.day)

  const item = ({ chore, day }: Todo, kind: 'late' | 'today' | 'coming') => {
    const isDone = done.has(completionKey(chore.id, day))
    return (
      <li key={`${chore.id}|${day}`}>
        <button
          className={`todo ${isDone ? 'done' : ''} ${kind === 'late' ? 'late' : ''}`}
          aria-pressed={isDone}
          onClick={() => void toggle(me, chore, day, isDone)}
        >
          <span className="box" aria-hidden>
            {isDone ? '✓' : ''}
          </span>
          <span>
            <strong>{chore.title}</strong>
            <span className="muted small">
              {kind === 'late'
                ? `Era per ${formatDayKey(day)}`
                : kind === 'coming'
                  ? `Entro ${formatDayKey(day)}`
                  : chore.schedule === 'daily' || chore.schedule === 'days'
                    ? 'Oggi'
                    : 'Scade oggi'}
            </span>
          </span>
        </button>
      </li>
    )
  }

  return (
    <section className="stack">
      <h1>Le mie faccende</h1>
      {error && <p className="error">{error}</p>}
      {chores === null && !error && <p className="muted">Caricamento…</p>}
      {late.length > 0 && (
        <div>
          <h2 className="error">Rimaste indietro</h2>
          <ul className="todo-list">{late.sort(byDay).map((t) => item(t, 'late'))}</ul>
        </div>
      )}
      {chores && (
        <div>
          <h2>Oggi</h2>
          {todays.length === 0 ? (
            <p className="muted">Niente da fare oggi.</p>
          ) : (
            <ul className="todo-list">{todays.map((t) => item(t, 'today'))}</ul>
          )}
        </div>
      )}
      {coming.length > 0 && (
        <div>
          <h2>Prossimi giorni</h2>
          <ul className="todo-list">{coming.sort(byDay).map((t) => item(t, 'coming'))}</ul>
        </div>
      )}
      {chores && (
        <p className="muted small">
          Tocca una faccenda quando l'hai fatta. Se alle {CHORE_REMINDER_HOUR}:00 del giorno in cui va fatta non è ancora
          segnata, ti arriva un promemoria.
        </p>
      )}
    </section>
  )
}
