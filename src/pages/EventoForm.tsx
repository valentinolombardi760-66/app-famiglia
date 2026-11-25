import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { CalendarEvent, EventKind, Member } from '../lib/types'
import { EVENT_KINDS } from '../lib/types'
import type { Recurrence } from '../../supabase/functions/_shared/recurrence.ts'
import { toDateKey, toWallTime } from '../../supabase/functions/_shared/recurrence.ts'
import { WEEKDAYS_SHORT, addDays, daysBetweenKeys, formatDayKey, formatTime, fromInputs, startOfDay, toInputs } from '../lib/dates'
import { loadEvents, occurrencesIn, peopleOf, type Occurrence } from '../lib/events'
import { conflictsFor, type Conflict } from '../lib/conflicts'
import { friendlyError } from '../lib/errors'
import { addDaysKey } from '../lib/money'
import { useUi } from '../components/ui'

const REMINDER_OPTIONS = [
  { minutes: 30, label: '30 minuti prima' },
  { minutes: 60, label: '1 ora prima' },
  { minutes: 120, label: '2 ore prima' },
  { minutes: 1440, label: '1 giorno prima' },
]

type Scope = 'only' | 'following' | 'all'

interface Props {
  me: Member
  members: Member[]
  event: CalendarEvent | null
  /** The occurrence that was tapped; for a repeating event, the one to change. */
  occurrence: Occurrence | null
  defaultDate: Date
  onClose: (changed: boolean) => void
}

export function EventoForm({ me, members, event, occurrence, defaultDate, onClose }: Props) {
  const ui = useUi()
  const canEdit = !event || me.role === 'genitore' || (event.created_by !== null && event.created_by === me.id)
  const repeating = event !== null && event.recurrence !== 'none'

  // The fields show the tapped occurrence, not the first one of the series.
  const initialStart = occurrence ? occurrence.start : event ? new Date(event.starts_at) : defaultStart(defaultDate)
  const initialEnd = occurrence ? occurrence.end : event ? new Date(event.ends_at) : new Date(initialStart.getTime() + 60 * 60_000)
  const s = toInputs(initialStart)
  const e = toInputs(event?.all_day ? addDays(initialEnd, -1) : initialEnd)
  const occurrenceDay = toDateKey(initialStart)
  const seriesFirstDay = event ? toDateKey(new Date(event.starts_at)) : occurrenceDay

  const [title, setTitle] = useState(event?.title ?? '')
  const [kind, setKind] = useState<EventKind>(event?.kind ?? 'impegno')
  const [allDay, setAllDay] = useState(event?.all_day ?? false)
  const [startDate, setStartDate] = useState(s.date)
  const [startTime, setStartTime] = useState(s.time)
  const [endDate, setEndDate] = useState(e.date)
  const [endTime, setEndTime] = useState(e.time)
  const [location, setLocation] = useState(event?.location ?? '')
  const [bring, setBring] = useState(event?.bring ?? '')
  const [driver, setDriver] = useState(event?.driver_id ?? '')
  const [notes, setNotes] = useState(event?.notes ?? '')
  const [who, setWho] = useState<string[]>(event ? event.event_members.map((m) => m.member_id) : [me.id])
  const [recurrence, setRecurrence] = useState<Recurrence>(event?.recurrence ?? 'none')
  const [weekdays, setWeekdays] = useState<number[]>(
    event?.recurrence_weekdays?.length ? event.recurrence_weekdays : [toWallTime(initialStart).weekday],
  )
  const [until, setUntil] = useState(event?.recurrence_until ?? '')
  const [reminders, setReminders] = useState<number[]>(event?.reminder_minutes ?? [60])
  // null = automatic: on for specific people, off for whole-family events
  // (otherwise all five phones buzz the evening before every family event).
  const [eveningBefore, setEveningBefore] = useState<boolean | null>(event ? event.remind_evening_before : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clashes, setClashes] = useState<Conflict[] | null>(null)
  const [moreOpen, setMoreOpen] = useState(Boolean(event?.bring || event?.driver_id || event?.notes))

  const wholeFamily = who.length === 0 || who.length === members.length
  const evening = eveningBefore ?? !wholeFamily

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  function times(): { start: Date; end: Date } {
    const start = fromInputs(startDate, allDay ? '00:00' : startTime)
    const end = allDay ? addDays(fromInputs(endDate, '00:00'), 1) : fromInputs(endDate, endTime)
    return { start, end }
  }

  /** Overlaps of the edited occurrence with other events of the same day(s). */
  async function findClashes(start: Date, end: Date): Promise<Conflict[]> {
    if (allDay) return []
    const from = startOfDay(start)
    const to = addDays(startOfDay(end), 1)
    const others = await loadEvents(from, to)
    if (!others) return [] // Offline: don't block saving over a check.
    const ids = members.map((m) => m.id)
    const draft: CalendarEvent = {
      ...(event ?? ({} as CalendarEvent)),
      id: event?.id ?? 'new',
      event_members: (wholeFamily ? [] : who).map((member_id) => ({ member_id })),
      driver_id: driver || null,
    }
    return conflictsFor(
      { key: 'draft', title: title.trim(), start, end, allDay: false, people: peopleOf(draft, ids), driverId: draft.driver_id },
      occurrencesIn(others.filter((o) => o.id !== event?.id), from, to).map((o) => ({
        key: o.key,
        title: o.event.title,
        start: o.start,
        end: o.end,
        allDay: o.event.all_day,
        people: peopleOf(o.event, ids),
        driverId: o.event.driver_id,
      })),
    )
  }

  async function chooseScope(verb: 'Modificare' | 'Eliminare'): Promise<Scope | null> {
    const fromHere = occurrenceDay !== seriesFirstDay
    return ui.ask<Scope>(
      `${verb} un impegno che si ripete`,
      `Scegli cosa ${verb === 'Modificare' ? 'cambiare' : 'togliere'}: la ripetizione di ${formatDayKey(occurrenceDay)} o più di una.`,
      [
        { value: 'only', label: `Solo ${formatDayKey(occurrenceDay)}` },
        ...(fromHere ? [{ value: 'following' as const, label: 'Da questa in poi' }] : []),
        { value: 'all', label: 'Tutte le ripetizioni', secondary: true },
      ],
    )
  }

  async function save(ev: FormEvent) {
    ev.preventDefault()
    const name = title.trim()
    if (!name) return setError('Scrivi cos\'è l\'impegno.')
    const { start, end } = times()
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return setError('Controlla data e ora.')
    if (end < start) return setError('La fine non può essere prima dell\'inizio.')
    if (recurrence === 'weekly' && weekdays.length === 0) return setError('Scegli almeno un giorno della settimana.')
    if (recurrence !== 'none' && until && until < startDate) return setError('"Fino al" non può essere prima dell\'inizio.')
    setError(null)

    // Overlaps warn once; a second tap on "Salva comunque" goes ahead.
    if (clashes === null) {
      setBusy(true)
      const found = await findClashes(start, end)
      setBusy(false)
      if (found.length > 0) return setClashes(found)
    }

    const scope: Scope | null = repeating && occurrence ? await chooseScope('Modificare') : 'all'
    if (!scope) return

    let seriesStart = start
    let seriesEnd = end
    if (scope === 'all' && repeating && occurrence) {
      // Moving this repetition by N days moves the whole series by N days.
      const shift = daysBetweenKeys(occurrenceDay, startDate)
      const firstDay = addDaysKey(seriesFirstDay, shift)
      seriesStart = fromInputs(firstDay, allDay ? '00:00' : startTime)
      seriesEnd = new Date(seriesStart.getTime() + (end.getTime() - start.getTime()))
    }

    const oneOff = scope === 'only'
    const params = {
      p_id: scope === 'all' ? (event?.id ?? null) : null,
      p_title: name,
      p_starts_at: seriesStart.toISOString(),
      p_ends_at: seriesEnd.toISOString(),
      p_all_day: allDay,
      p_location: location,
      p_notes: notes,
      p_recurrence: oneOff ? 'none' : recurrence,
      p_recurrence_weekdays: !oneOff && recurrence === 'weekly' ? [...weekdays].sort() : null,
      p_recurrence_until: !oneOff && recurrence !== 'none' && until ? until : null,
      p_reminder_minutes: allDay ? [] : reminders,
      p_remind_evening_before: evening,
      p_member_ids: wholeFamily ? [] : who,
      p_kind: kind,
      p_bring: bring,
      p_driver_id: driver || null,
      p_split_from: scope === 'all' ? null : event!.id,
      p_split_date: scope === 'all' ? null : occurrenceDay,
      p_split_mode: scope === 'all' ? null : scope,
    }
    setBusy(true)
    const { error } = await supabase.rpc('save_event', params)
    setBusy(false)
    if (error) return setError(friendlyError(error))
    ui.toast(scope === 'only' ? `Cambiato solo ${formatDayKey(occurrenceDay)}.` : 'Impegno salvato.')
    onClose(true)
  }

  async function remove() {
    if (!event) return
    const scope: Scope | null = repeating && occurrence ? await chooseScope('Eliminare') : 'all'
    if (!scope) return
    setBusy(true)
    let undo: (() => Promise<void>) | undefined
    let result
    if (scope === 'only') {
      result = await supabase.rpc('skip_occurrence', { p_id: event.id, p_date: occurrenceDay, p_skip: true })
      undo = async () => {
        await supabase.rpc('skip_occurrence', { p_id: event.id, p_date: occurrenceDay, p_skip: false })
        onClose(true)
      }
    } else if (scope === 'following') {
      const previous = event.recurrence_until
      result = await supabase.from('events').update({ recurrence_until: addDaysKey(occurrenceDay, -1) }).eq('id', event.id).select('id')
      if (!result.error && result.data.length === 0) result = { error: { code: '42501' } }
      undo = async () => {
        await supabase.from('events').update({ recurrence_until: previous }).eq('id', event.id)
        onClose(true)
      }
    } else {
      result = await supabase.from('events').delete().eq('id', event.id).select('id')
      if (!result.error && result.data.length === 0) result = { error: { code: '42501' } }
      undo = async () => {
        await recreate(event)
        onClose(true)
      }
    }
    setBusy(false)
    if (result.error) return setError(friendlyError(result.error, 'eliminare'))
    ui.toast(
      scope === 'only' ? `Tolto ${formatDayKey(occurrenceDay)}.` : scope === 'following' ? 'Tolte le prossime ripetizioni.' : 'Impegno eliminato.',
      undo,
    )
    onClose(true)
  }

  const memberOptions = [...members].sort((a, b) => Number(b.role === 'genitore') - Number(a.role === 'genitore'))

  return (
    <section>
      <header className="form-header">
        <button className="link" onClick={() => onClose(false)}>
          ‹ Indietro
        </button>
        <h1>{event ? (canEdit ? 'Modifica impegno' : 'Impegno') : 'Nuovo impegno'}</h1>
      </header>
      {!canEdit && <p className="muted">Solo chi l'ha creato o un genitore può modificarlo.</p>}
      {repeating && canEdit && (
        <p className="muted small">
          Stai guardando la ripetizione di {formatDayKey(occurrenceDay)}. Al salvataggio scegli se cambiare solo questa o
          anche le altre.
        </p>
      )}
      <form onSubmit={save} className="stack">
        <fieldset disabled={!canEdit || busy}>
          <label>
            Cosa
            <input required maxLength={120} value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Es. Allenamento Diego" />
          </label>

          <div className="chips" role="group" aria-label="Tipo">
            {EVENT_KINDS.map((k) => (
              <button
                type="button"
                key={k.key}
                className={kind === k.key ? 'chip on' : 'chip'}
                aria-pressed={kind === k.key}
                onClick={() => {
                  setKind(k.key)
                  if (k.key === 'sport') setMoreOpen(true)
                }}
              >
                {k.icon} {k.label}
              </button>
            ))}
          </div>

          <label className="check">
            <input type="checkbox" checked={allDay} onChange={(ev) => setAllDay(ev.target.checked)} />
            Tutto il giorno
          </label>

          <div className="row">
            <label>
              Inizio
              <input
                type="date"
                required
                value={startDate}
                onChange={(ev) => {
                  setStartDate(ev.target.value)
                  if (ev.target.value > endDate) setEndDate(ev.target.value)
                  setClashes(null)
                }}
              />
            </label>
            {!allDay && (
              <label>
                Ora
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={(ev) => {
                    // Keep the same length when the start moves.
                    const oldStart = fromInputs(startDate, startTime)
                    const oldEnd = fromInputs(endDate, endTime)
                    const next = fromInputs(startDate, ev.target.value || startTime)
                    setStartTime(ev.target.value)
                    if (!Number.isNaN(next.getTime()) && oldEnd >= oldStart) {
                      const moved = toInputs(new Date(next.getTime() + (oldEnd.getTime() - oldStart.getTime())))
                      setEndDate(moved.date)
                      setEndTime(moved.time)
                    }
                    setClashes(null)
                  }}
                />
              </label>
            )}
          </div>
          <div className="row">
            <label>
              Fine
              <input type="date" required value={endDate} onChange={(ev) => { setEndDate(ev.target.value); setClashes(null) }} />
            </label>
            {!allDay && (
              <label>
                Ora
                <input type="time" required value={endTime} onChange={(ev) => { setEndTime(ev.target.value); setClashes(null) }} />
              </label>
            )}
          </div>

          <div className="field">
            <span>Per chi</span>
            <div className="chips">
              {members.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className={who.includes(m.id) ? 'chip on' : 'chip'}
                  style={who.includes(m.id) ? { background: m.color, borderColor: m.color, color: '#fff' } : undefined}
                  onClick={() => {
                    setWho(toggle(who, m.id))
                    setClashes(null)
                  }}
                  aria-pressed={who.includes(m.id)}
                >
                  {!who.includes(m.id) && <span className="dot" style={{ background: m.color }} aria-hidden />}
                  {m.name}
                </button>
              ))}
            </div>
            {wholeFamily && <span className="muted small">Tutta la famiglia</span>}
          </div>

          <label>
            Dove
            <input maxLength={200} value={location} onChange={(ev) => setLocation(ev.target.value)} placeholder="Facoltativo" />
          </label>

          <details open={moreOpen} onToggle={(ev) => setMoreOpen((ev.target as HTMLDetailsElement).open)}>
            <summary>Cosa portare, chi accompagna, note</summary>
            <div className="stack">
              <label>
                Cosa portare
                <input maxLength={300} value={bring} onChange={(ev) => setBring(ev.target.value)} placeholder="Es. borsa, scarpe, tessera" />
              </label>
              <label>
                Chi accompagna
                <select
                  value={driver}
                  onChange={(ev) => {
                    setDriver(ev.target.value)
                    setClashes(null)
                  }}
                >
                  <option value="">Nessuno / non serve</option>
                  {memberOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Note
                <textarea rows={3} maxLength={1000} value={notes} onChange={(ev) => setNotes(ev.target.value)} />
              </label>
            </div>
          </details>

          <label>
            Si ripete
            <select value={recurrence} onChange={(ev) => setRecurrence(ev.target.value as Recurrence)}>
              <option value="none">No</option>
              <option value="daily">Ogni giorno</option>
              <option value="weekly">Ogni settimana</option>
              <option value="monthly">Ogni mese</option>
            </select>
          </label>
          {recurrence === 'weekly' && (
            <div className="chips">
              {WEEKDAYS_SHORT.map((label, i) => (
                <button
                  type="button"
                  key={label}
                  className={weekdays.includes(i + 1) ? 'chip on' : 'chip'}
                  onClick={() => setWeekdays(toggle(weekdays, i + 1))}
                  aria-pressed={weekdays.includes(i + 1)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {recurrence !== 'none' && (
            <label>
              Fino al (facoltativo)
              <input type="date" value={until} min={startDate} onChange={(ev) => setUntil(ev.target.value)} />
            </label>
          )}

          <div className="field">
            <span>Promemoria sul telefono</span>
            <label className="check">
              <input type="checkbox" checked={evening} onChange={(ev) => setEveningBefore(ev.target.checked)} />
              La sera prima alle 20:00
            </label>
            {!allDay &&
              REMINDER_OPTIONS.map((o) => (
                <label className="check" key={o.minutes}>
                  <input
                    type="checkbox"
                    checked={reminders.includes(o.minutes)}
                    onChange={() => setReminders(toggle(reminders, o.minutes))}
                  />
                  {o.label}
                </label>
              ))}
          </div>
        </fieldset>

        {clashes && clashes.length > 0 && (
          <div className="warning" role="alert">
            <strong>Si sovrappone ad altri impegni:</strong>
            <ul>
              {clashes.map((c) => (
                <li key={`${c.memberId}-${c.other.key}`}>
                  {members.find((m) => m.id === c.memberId)?.name ?? 'Qualcuno'}
                  {c.asDriver ? ' (accompagna)' : ''}: «{c.other.title}» alle {formatTime(c.other.start)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {canEdit && (
          <div className="actions">
            <button disabled={busy}>{busy ? 'Attendi…' : clashes?.length ? 'Salva comunque' : 'Salva'}</button>
            {event && (
              <button type="button" className="danger" disabled={busy} onClick={remove}>
                Elimina
              </button>
            )}
          </div>
        )}
      </form>
    </section>
  )
}

/** Puts back a deleted event (used by "Annulla"). It gets a new id and the current user as creator. */
async function recreate(event: CalendarEvent) {
  const { data: id } = await supabase.rpc('save_event', {
    p_id: null,
    p_title: event.title,
    p_starts_at: event.starts_at,
    p_ends_at: event.ends_at,
    p_all_day: event.all_day,
    p_location: event.location ?? '',
    p_notes: event.notes ?? '',
    p_recurrence: event.recurrence,
    p_recurrence_weekdays: event.recurrence_weekdays,
    p_recurrence_until: event.recurrence_until,
    p_reminder_minutes: event.reminder_minutes,
    p_remind_evening_before: event.remind_evening_before,
    p_member_ids: event.event_members.map((m) => m.member_id),
    p_kind: event.kind,
    p_bring: event.bring ?? '',
    p_driver_id: event.driver_id,
  })
  if (id && event.skipped_dates.length > 0) {
    await supabase.from('events').update({ skipped_dates: event.skipped_dates }).eq('id', id)
  }
}

/** New events start at the next full hour today, or at 9:00 on another day. */
function defaultStart(date: Date): Date {
  const now = new Date()
  if (toDateKey(date) !== toDateKey(now)) {
    const d = toInputs(date)
    return fromInputs(d.date, '09:00')
  }
  const d = new Date(now)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}
