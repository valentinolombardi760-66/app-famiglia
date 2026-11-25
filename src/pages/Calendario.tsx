import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CalendarEvent, EventKind, Member } from '../lib/types'
import { EVENT_KINDS } from '../lib/types'
import { toDateKey } from '../../supabase/functions/_shared/recurrence.ts'
import { addDays, formatDayTitle, formatTime, formatWeekRange, startOfWeek } from '../lib/dates'
import { concerns, loadEvents, occurrencesIn, onDay, peopleOf, type Occurrence } from '../lib/events'
import { findConflicts, type Conflict } from '../lib/conflicts'
import { useResume } from '../lib/useResume'
import { WeekNav } from '../components/WeekNav'
import { MemberChip } from '../components/MemberChip'
import { EventoForm } from './EventoForm'

type Editing = { occurrence: Occurrence } | { newOn: Date }

export function Calendario({ me, members }: { me: Member; members: Member[] }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [person, setPerson] = useState<string>('all')
  const [kind, setKind] = useState<EventKind | 'all'>('all')
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])

  const load = useCallback(async () => {
    setLoading(true)
    const result = await loadEvents(weekStart, weekEnd)
    setLoading(false)
    if (!result) return setError('Impossibile caricare gli impegni. Controlla la connessione.')
    setError(null)
    setEvents(result)
  }, [weekStart, weekEnd])

  useEffect(() => {
    void load()
  }, [load])
  useResume(() => void load())

  const memberIds = useMemo(() => members.map((m) => m.id), [members])
  const all = useMemo(() => occurrencesIn(events, weekStart, weekEnd), [events, weekStart, weekEnd])
  // Overlaps are computed on everything, so filtering never hides a clash's existence.
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
  const shown = all.filter(
    (o) => (person === 'all' || concerns(o.event, person)) && (kind === 'all' || o.event.kind === kind),
  )
  const days = Array.from({ length: 7 }, (_, i) => {
    const dayStart = addDays(weekStart, i)
    return { date: dayStart, items: onDay(shown, dayStart, addDays(weekStart, i + 1)) }
  })
  const clashCount = new Set(
    [...conflicts.entries()]
      .filter(([key]) => shown.some((o) => o.key === key))
      .flatMap(([key, list]) => list.map((c) => [key, c.other.key].sort().join('~'))),
  ).size

  const todayKey = toDateKey(new Date())
  const byId = new Map(members.map((m) => [m.id, m]))

  if (editing) {
    const isCurrentWeek = weekStart <= new Date() && new Date() < weekEnd
    return (
      <EventoForm
        me={me}
        members={members}
        event={'occurrence' in editing ? editing.occurrence.event : null}
        occurrence={'occurrence' in editing ? editing.occurrence : null}
        defaultDate={'newOn' in editing ? editing.newOn : isCurrentWeek ? new Date() : weekStart}
        onClose={(changed) => {
          setEditing(null)
          if (changed) void load()
        }}
      />
    )
  }

  return (
    <section>
      <h1>Calendario</h1>
      <WeekNav
        label={formatWeekRange(weekStart)}
        onPrev={() => setWeekStart(addDays(weekStart, -7))}
        onNext={() => setWeekStart(addDays(weekStart, 7))}
        onToday={() => setWeekStart(startOfWeek(new Date()))}
      />
      <div className="filters">
        <div className="chips" role="group" aria-label="Di chi">
          <button className={person === 'all' ? 'chip small on' : 'chip small'} aria-pressed={person === 'all'} onClick={() => setPerson('all')}>
            Tutti
          </button>
          {members.map((m) => (
            <button
              key={m.id}
              className={person === m.id ? 'chip small on' : 'chip small'}
              aria-pressed={person === m.id}
              onClick={() => setPerson(person === m.id ? 'all' : m.id)}
            >
              <span className="dot" style={{ background: m.color }} aria-hidden />
              {m.id === me.id ? 'Io' : m.name}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Tipo">
          <button className={kind === 'all' ? 'chip small on' : 'chip small'} aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
            Ogni tipo
          </button>
          {EVENT_KINDS.map((k) => (
            <button
              key={k.key}
              className={kind === k.key ? 'chip small on' : 'chip small'}
              aria-pressed={kind === k.key}
              onClick={() => setKind(kind === k.key ? 'all' : k.key)}
            >
              {k.icon} {k.label}
            </button>
          ))}
        </div>
      </div>
      {clashCount > 0 && (
        <p className="warning">
          ⚠️ {clashCount === 1 ? '1 sovrapposizione' : `${clashCount} sovrapposizioni`} in questa settimana: sono
          segnate qui sotto.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {loading && events.length === 0 && <p className="muted">Caricamento…</p>}
      <ol className="days">
        {days.map(({ date, items }) => (
          <li key={date.toISOString()} className={toDateKey(date) === todayKey ? 'day today' : 'day'}>
            <div className="day-head">
              <h2>{formatDayTitle(date)}</h2>
              <button
                className="icon small"
                aria-label={`Nuovo impegno ${formatDayTitle(date)}`}
                onClick={() => setEditing({ newOn: date })}
              >
                +
              </button>
            </div>
            {items.length === 0 ? (
              <p className="muted small">Nessun impegno</p>
            ) : (
              <ul>
                {items.map((it) => (
                  <li key={it.key}>
                    <EventRow item={it} byId={byId} conflicts={conflicts.get(it.key)} onOpen={() => setEditing({ occurrence: it })} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <button className="fab" aria-label="Nuovo impegno" onClick={() => setEditing({ newOn: new Date() })}>
        +
      </button>
    </section>
  )
}

const KIND = new Map(EVENT_KINDS.map((k) => [k.key, k]))

export function EventRow({
  item,
  byId,
  conflicts,
  onOpen,
}: {
  item: Occurrence
  byId: Map<string, Member>
  conflicts?: Conflict[]
  onOpen: () => void
}) {
  const e = item.event
  const driver = e.driver_id ? byId.get(e.driver_id) : undefined
  const sameTime = item.end.getTime() === item.start.getTime()
  return (
    <button className={conflicts?.length ? 'event clash' : 'event'} onClick={onOpen}>
      <span className="time">
        {e.all_day ? 'Tutto il giorno' : sameTime ? formatTime(item.start) : `${formatTime(item.start)}–${formatTime(item.end)}`}
      </span>
      <span className="title">
        <span aria-label={KIND.get(e.kind)?.label}>{KIND.get(e.kind)?.icon}</span> {e.title}
        {e.recurrence !== 'none' && <span aria-label="Si ripete"> 🔁</span>}
      </span>
      {e.location && <span className="place">📍 {e.location}</span>}
      {e.bring && <span className="place">🎒 Porta: {e.bring}</span>}
      {driver && <span className="place">🚗 Accompagna {driver.name}</span>}
      <span className="who">
        {e.event_members.length === 0 ? (
          <span className="chip">Tutta la famiglia</span>
        ) : (
          e.event_members.map(({ member_id }) => {
            const m = byId.get(member_id)
            return m ? <MemberChip key={member_id} member={m} /> : null
          })
        )}
      </span>
      {conflicts?.map((c) => (
        <span key={`${c.memberId}-${c.other.key}`} className="clash-note">
          ⚠️ {byId.get(c.memberId)?.name ?? 'Qualcuno'}
          {c.asDriver ? ' (accompagna)' : ''} ha anche «{c.other.title}» alle {formatTime(c.other.start)}
        </span>
      ))}
    </button>
  )
}
