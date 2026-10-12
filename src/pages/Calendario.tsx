import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CalendarEvent, Member } from '../lib/types'
import { expandOccurrences, toDateKey } from '../../supabase/functions/_shared/recurrence.ts'
import { addDays, formatDayTitle, formatTime, formatWeekRange, startOfWeek } from '../lib/dates'
import { EventoForm } from './EventoForm'

const EVENT_COLUMNS =
  'id, title, starts_at, ends_at, all_day, location, notes, recurrence, recurrence_weekdays, recurrence_until, reminder_minutes, remind_evening_before, created_by, event_members(member_id)'

interface Item {
  event: CalendarEvent
  start: Date
  end: Date
}

export function Calendario({ me, members }: { me: Member; members: Member[] }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [onlyMine, setOnlyMine] = useState(false)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<CalendarEvent | 'new' | null>(null)

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])

  const load = useCallback(async () => {
    setLoading(true)
    const from = weekStart.toISOString()
    const to = weekEnd.toISOString()
    const fromDay = toDateKey(weekStart)
    // One-off events that overlap the week, plus every repeating event that has started and not ended.
    const [oneOff, repeating] = await Promise.all([
      supabase.from('events').select(EVENT_COLUMNS).eq('recurrence', 'none').lt('starts_at', to).gte('ends_at', from),
      supabase
        .from('events')
        .select(EVENT_COLUMNS)
        .neq('recurrence', 'none')
        .lt('starts_at', to)
        .or(`recurrence_until.is.null,recurrence_until.gte.${fromDay}`),
    ])
    setLoading(false)
    if (oneOff.error || repeating.error) {
      setError('Impossibile caricare gli impegni. Controlla la connessione.')
      return
    }
    setError(null)
    setEvents([...(oneOff.data ?? []), ...(repeating.data ?? [])] as CalendarEvent[])
  }, [weekStart, weekEnd])

  useEffect(() => {
    void load()
  }, [load])

  const days = useMemo(() => {
    const items: Item[] = []
    for (const event of events) {
      const forMe = event.event_members.length === 0 || event.event_members.some((m) => m.member_id === me.id)
      if (onlyMine && !forMe) continue
      for (const occ of expandOccurrences(event, weekStart, weekEnd)) items.push({ event, ...occ })
    }
    items.sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.event.all_day) - Number(a.event.all_day))
    return Array.from({ length: 7 }, (_, i) => {
      const dayStart = addDays(weekStart, i)
      const dayEnd = addDays(weekStart, i + 1)
      return {
        date: dayStart,
        items: items.filter((it) => it.start < dayEnd && (it.end > dayStart || it.start >= dayStart)),
      }
    })
  }, [events, onlyMine, me.id, weekStart, weekEnd])

  const todayKey = toDateKey(new Date())
  const byId = new Map(members.map((m) => [m.id, m]))

  if (editing) {
    return (
      <EventoForm
        me={me}
        members={members}
        event={editing === 'new' ? null : editing}
        defaultDate={weekStart <= new Date() && new Date() < weekEnd ? new Date() : weekStart}
        onClose={(changed) => {
          setEditing(null)
          if (changed) void load()
        }}
      />
    )
  }

  return (
    <section>
      <header className="cal-header">
        <h1>Calendario</h1>
        <div className="segmented" role="group" aria-label="Filtro">
          <button className={!onlyMine ? 'on' : ''} onClick={() => setOnlyMine(false)}>
            Tutti
          </button>
          <button className={onlyMine ? 'on' : ''} onClick={() => setOnlyMine(true)}>
            Solo i miei
          </button>
        </div>
      </header>
      <div className="week-nav">
        <button className="icon" aria-label="Settimana precedente" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          ‹
        </button>
        <button className="link" onClick={() => setWeekStart(startOfWeek(new Date()))}>
          {formatWeekRange(weekStart)}
        </button>
        <button className="icon" aria-label="Settimana successiva" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          ›
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {loading && events.length === 0 && <p className="muted">Caricamento…</p>}
      <ol className="days">
        {days.map(({ date, items }) => (
          <li key={date.toISOString()} className={toDateKey(date) === todayKey ? 'day today' : 'day'}>
            <h2>{formatDayTitle(date)}</h2>
            {items.length === 0 ? (
              <p className="muted small">Nessun impegno</p>
            ) : (
              <ul>
                {items.map((it) => (
                  <li key={`${it.event.id}-${it.start.toISOString()}`}>
                    <button className="event" onClick={() => setEditing(it.event)}>
                      <span className="time">{it.event.all_day ? 'Tutto il giorno' : formatTime(it.start)}</span>
                      <span className="title">
                        {it.event.title}
                        {it.event.recurrence !== 'none' && <span aria-label="Si ripete"> 🔁</span>}
                      </span>
                      {it.event.location && <span className="place">{it.event.location}</span>}
                      <span className="who">
                        {it.event.event_members.length === 0 ? (
                          <span className="chip">Tutta la famiglia</span>
                        ) : (
                          it.event.event_members.map(({ member_id }) => {
                            const m = byId.get(member_id)
                            return m ? (
                              <span key={member_id} className="chip" style={{ borderColor: m.color, color: m.color }}>
                                {m.name}
                              </span>
                            ) : null
                          })
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <button className="fab" aria-label="Nuovo impegno" onClick={() => setEditing('new')}>
        +
      </button>
    </section>
  )
}
