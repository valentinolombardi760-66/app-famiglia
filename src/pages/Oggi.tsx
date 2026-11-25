import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CalendarEvent, Member } from '../lib/types'
import { toDateKey } from '../../supabase/functions/_shared/recurrence.ts'
import { choreDueDates, completionKey } from '../../supabase/functions/_shared/chores.ts'
import { addDays, formatDayKey, formatDayTitle, formatTime, startOfDay } from '../lib/dates'
import { concerns, loadEvents, occurrencesIn, onDay, peopleOf, type Occurrence } from '../lib/events'
import { findConflicts } from '../lib/conflicts'
import { addDaysKey } from '../lib/money'
import { useResume } from '../lib/useResume'
import { EventRow } from './Calendario'
import { EventoForm } from './EventoForm'
import { useChores } from './Faccende'

// Overlaps are looked for this many days ahead.
const CLASH_DAYS = 7

/** The first screen: what matters today and tomorrow, plus overlaps coming up. */
export function Oggi({ me, members, onGo }: { me: Member; members: Member[]; onGo: (tab: 'calendario' | 'faccende') => void }) {
  const [now, setNow] = useState(() => new Date())
  const [onlyMine, setOnlyMine] = useState(false)
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Occurrence | null>(null)

  const today = toDateKey(now)
  const dayStart = useMemo(() => startOfDay(now), [now])
  const tomorrow = useMemo(() => addDays(dayStart, 1), [dayStart])
  const horizon = useMemo(() => addDays(dayStart, CLASH_DAYS), [dayStart])

  const load = useCallback(async () => {
    const result = await loadEvents(dayStart, horizon)
    if (!result) return setError('Impossibile caricare gli impegni. Controlla la connessione.')
    setError(null)
    setEvents(result)
  }, [dayStart, horizon])

  useEffect(() => {
    void load()
  }, [load])
  // After a night in the background, "today" must move on.
  useResume(() => {
    if (toDateKey(new Date()) !== today) setNow(new Date())
    else void load()
  })

  const memberIds = useMemo(() => members.map((m) => m.id), [members])
  const all = useMemo(() => occurrencesIn(events ?? [], dayStart, horizon), [events, dayStart, horizon])
  const conflicts = useMemo(
    () =>
      findConflicts(
        all.map((o) => ({
          key: o.key,
          title: o.event.title,
          start: o.start,
          end: o.end,
          allDay: o.event.all_day,
          people: peopleOf(o.event, memberIds),
          driverId: o.event.driver_id,
        })),
      ),
    [all, memberIds],
  )
  const byId = new Map(members.map((m) => [m.id, m]))
  const visible = all.filter((o) => !onlyMine || concerns(o.event, me.id))
  const todays = onDay(visible, dayStart, tomorrow)
  const tomorrows = onDay(visible, tomorrow, addDays(tomorrow, 1))

  // Each clash once, as "who: A / B", in time order.
  const clashes = useMemo(() => {
    const seen = new Set<string>()
    const out: { id: string; day: Date; who: string; a: string; aAt: Date; b: string; bAt: Date }[] = []
    for (const o of all) {
      for (const c of conflicts.get(o.key) ?? []) {
        const id = [o.key, c.other.key, c.memberId].sort().join('~')
        if (seen.has(id) || (onlyMine && c.memberId !== me.id)) continue
        seen.add(id)
        const name = byId.get(c.memberId)?.name ?? 'Qualcuno'
        out.push({ id, day: o.start, who: c.asDriver ? `${name} (accompagna)` : name, a: o.event.title, aAt: o.start, b: c.other.title, bAt: c.other.start })
      }
    }
    return out
  }, [all, conflicts, onlyMine, me.id, members])

  if (editing) {
    return (
      <EventoForm
        me={me}
        members={members}
        event={editing.event}
        occurrence={editing}
        defaultDate={now}
        onClose={(changed) => {
          setEditing(null)
          if (changed) void load()
        }}
      />
    )
  }

  return (
    <section className="stack">
      <header className="cal-header">
        <div>
          <h1>Oggi</h1>
          <p className="muted small capital">{formatDayTitle(now)}</p>
        </div>
        <div className="segmented" role="group" aria-label="Filtro">
          <button className={!onlyMine ? 'on' : ''} onClick={() => setOnlyMine(false)}>
            Tutti
          </button>
          <button className={onlyMine ? 'on' : ''} onClick={() => setOnlyMine(true)}>
            Solo i miei
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}

      {clashes.length > 0 && (
        <div className="warning">
          <strong>⚠️ Sovrapposizioni nei prossimi {CLASH_DAYS} giorni</strong>
          <ul>
            {clashes.map((c) => (
              <li key={c.id}>
                <span className="capital">{formatDayKey(toDateKey(c.day))}</span>, {c.who}: «{c.a}» {formatTime(c.aAt)} e «{c.b}»{' '}
                {formatTime(c.bAt)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ChoresToday me={me} members={members} today={today} onGo={() => onGo('faccende')} />

      <div>
        <h2>Impegni di oggi</h2>
        {events === null && !error && <p className="muted">Caricamento…</p>}
        {events && todays.length === 0 && <p className="muted">Niente in programma oggi.</p>}
        <ul className="plain">
          {todays.map((it) => (
            <li key={it.key}>
              <EventRow item={it} byId={byId} conflicts={conflicts.get(it.key)} onOpen={() => setEditing(it)} />
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2>Domani</h2>
        {events && tomorrows.length === 0 && <p className="muted">Nessun impegno.</p>}
        <ul className="plain">
          {tomorrows.map((it) => (
            <li key={it.key}>
              <EventRow item={it} byId={byId} conflicts={conflicts.get(it.key)} onOpen={() => setEditing(it)} />
            </li>
          ))}
        </ul>
      </div>

      <button className="link fab-clear" onClick={() => onGo('calendario')}>
        Vedi tutta la settimana ›
      </button>
    </section>
  )
}

/** Sons: today's chores to tick. Parents: how each son is doing today. */
function ChoresToday({ me, members, today, onGo }: { me: Member; members: Member[]; today: string; onGo: () => void }) {
  const from = addDaysKey(today, -6)
  const to = addDaysKey(today, 1)
  const { chores, done, toggle } = useChores(from, to)
  if (!chores) return null

  const isParent = me.role === 'genitore'
  const sons = members.filter((m) => m.role === 'figlio')
  // Due today, plus weekly or one-off deadlines from the last days still not done.
  const open = chores.flatMap((c) =>
    choreDueDates(c, from, to)
      .filter((d) => d === today || (c.schedule !== 'daily' && c.schedule !== 'days' && !done.has(completionKey(c.id, d))))
      .map((day) => ({ chore: c, day, isDone: done.has(completionKey(c.id, day)) })),
  )
  if (open.length === 0) {
    return isParent ? null : (
      <div className="card">
        <h2>Le mie faccende</h2>
        <p className="muted small">Niente da fare oggi. 🎉</p>
      </div>
    )
  }

  if (!isParent) {
    return (
      <div className="card">
        <h2>Le mie faccende</h2>
        <ul className="todo-list">
          {open.map(({ chore, day, isDone }) => (
            <li key={`${chore.id}|${day}`}>
              <button
                className={`todo ${isDone ? 'done' : ''} ${day < today ? 'late' : ''}`}
                aria-pressed={isDone}
                onClick={() => void toggle(me, chore, day, isDone)}
              >
                <span className="box" aria-hidden>
                  {isDone ? '✓' : ''}
                </span>
                <span>
                  <strong>{chore.title}</strong>
                  <span className="muted small">{day < today ? `Era per ${formatDayKey(day)}` : 'Oggi'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <button className="card summary-link" onClick={onGo}>
      <h2>Faccende di oggi</h2>
      <ul className="son-status">
        {sons.map((s) => {
          const mine = open.filter((o) => o.chore.assigned_to === s.id)
          if (mine.length === 0) return null
          const doneCount = mine.filter((o) => o.isDone).length
          const missing = mine.filter((o) => !o.isDone).map((o) => o.chore.title)
          return (
            <li key={s.id}>
              <span>
                <span className="dot" style={{ background: s.color }} aria-hidden /> <strong>{s.name}</strong>
              </span>
              <span className={doneCount === mine.length ? 'ok' : 'muted'}>
                {doneCount === mine.length ? '✓ tutto fatto' : `${doneCount} di ${mine.length} · manca: ${missing.join(', ')}`}
              </span>
            </li>
          )
        })}
      </ul>
    </button>
  )
}
