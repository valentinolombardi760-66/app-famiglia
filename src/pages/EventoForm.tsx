import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { CalendarEvent, Member } from '../lib/types'
import type { Recurrence } from '../../supabase/functions/_shared/recurrence.ts'
import { toWallTime } from '../../supabase/functions/_shared/recurrence.ts'
import { WEEKDAYS_SHORT, addDays, fromInputs, toInputs } from '../lib/dates'

const REMINDER_OPTIONS = [
  { minutes: 30, label: '30 minuti prima' },
  { minutes: 60, label: '1 ora prima' },
  { minutes: 120, label: '2 ore prima' },
  { minutes: 1440, label: '1 giorno prima' },
]

interface Props {
  me: Member
  members: Member[]
  event: CalendarEvent | null
  defaultDate: Date
  onClose: (changed: boolean) => void
}

export function EventoForm({ me, members, event, defaultDate, onClose }: Props) {
  const canEdit = !event || me.role === 'genitore' || event.created_by === me.id

  const initialStart = event ? new Date(event.starts_at) : roundToNextHour(defaultDate)
  const initialEnd = event ? new Date(event.ends_at) : new Date(initialStart.getTime() + 60 * 60_000)
  const s = toInputs(initialStart)
  const e = toInputs(event?.all_day ? addDays(initialEnd, -1) : initialEnd)

  const [title, setTitle] = useState(event?.title ?? '')
  const [allDay, setAllDay] = useState(event?.all_day ?? false)
  const [startDate, setStartDate] = useState(s.date)
  const [startTime, setStartTime] = useState(s.time)
  const [endDate, setEndDate] = useState(e.date)
  const [endTime, setEndTime] = useState(e.time)
  const [location, setLocation] = useState(event?.location ?? '')
  const [notes, setNotes] = useState(event?.notes ?? '')
  const [who, setWho] = useState<string[]>(event ? event.event_members.map((m) => m.member_id) : [me.id])
  const [recurrence, setRecurrence] = useState<Recurrence>(event?.recurrence ?? 'none')
  const [weekdays, setWeekdays] = useState<number[]>(
    event?.recurrence_weekdays?.length ? event.recurrence_weekdays : [toWallTime(initialStart).weekday],
  )
  const [until, setUntil] = useState(event?.recurrence_until ?? '')
  const [reminders, setReminders] = useState<number[]>(event?.reminder_minutes ?? [60])
  const [eveningBefore, setEveningBefore] = useState(event?.remind_evening_before ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  async function save(ev: FormEvent) {
    ev.preventDefault()
    const start = fromInputs(startDate, allDay ? '00:00' : startTime)
    const end = allDay ? addDays(fromInputs(endDate, '00:00'), 1) : fromInputs(endDate, endTime)
    if (end < start) {
      setError('La fine non può essere prima dell\'inizio.')
      return
    }
    if (recurrence === 'weekly' && weekdays.length === 0) {
      setError('Scegli almeno un giorno della settimana.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('save_event', {
      p_id: event?.id ?? null,
      p_title: title.trim(),
      p_starts_at: start.toISOString(),
      p_ends_at: end.toISOString(),
      p_all_day: allDay,
      p_location: location,
      p_notes: notes,
      p_recurrence: recurrence,
      p_recurrence_weekdays: recurrence === 'weekly' ? [...weekdays].sort() : null,
      p_recurrence_until: recurrence !== 'none' && until ? until : null,
      p_reminder_minutes: allDay ? [] : reminders,
      p_remind_evening_before: eveningBefore,
      p_member_ids: who.length === members.length ? [] : who,
    })
    setBusy(false)
    if (error) setError(`Salvataggio non riuscito: ${error.message}`)
    else onClose(true)
  }

  async function remove() {
    const what = event!.recurrence === 'none' ? 'questo impegno' : 'questo impegno e tutte le sue ripetizioni'
    if (!confirm(`Eliminare ${what}?`)) return
    setBusy(true)
    const { error } = await supabase.from('events').delete().eq('id', event!.id)
    setBusy(false)
    if (error) setError(`Eliminazione non riuscita: ${error.message}`)
    else onClose(true)
  }

  return (
    <section>
      <header className="form-header">
        <button className="link" onClick={() => onClose(false)}>
          ‹ Indietro
        </button>
        <h1>{event ? (canEdit ? 'Modifica impegno' : 'Impegno') : 'Nuovo impegno'}</h1>
      </header>
      {!canEdit && <p className="muted">Solo chi l'ha creato o un genitore può modificarlo.</p>}
      {event && event.recurrence !== 'none' && canEdit && (
        <p className="muted small">Le modifiche valgono per tutte le ripetizioni.</p>
      )}
      <form onSubmit={save} className="stack">
        <fieldset disabled={!canEdit || busy}>
          <label>
            Cosa
            <input required maxLength={120} value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Es. Dentista Diego" />
          </label>

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
                }}
              />
            </label>
            {!allDay && (
              <label>
                Ora
                <input type="time" required value={startTime} onChange={(ev) => setStartTime(ev.target.value)} />
              </label>
            )}
          </div>
          <div className="row">
            <label>
              Fine
              <input type="date" required value={endDate} onChange={(ev) => setEndDate(ev.target.value)} />
            </label>
            {!allDay && (
              <label>
                Ora
                <input type="time" required value={endTime} onChange={(ev) => setEndTime(ev.target.value)} />
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
                  style={who.includes(m.id) ? { background: m.color, borderColor: m.color } : { borderColor: m.color }}
                  onClick={() => setWho(toggle(who, m.id))}
                  aria-pressed={who.includes(m.id)}
                >
                  {m.name}
                </button>
              ))}
            </div>
            <span className="muted small">
              {who.length === 0 || who.length === members.length ? 'Tutta la famiglia' : ''}
            </span>
          </div>

          <label>
            Dove
            <input maxLength={200} value={location} onChange={(ev) => setLocation(ev.target.value)} />
          </label>

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
              <input type="checkbox" checked={eveningBefore} onChange={(ev) => setEveningBefore(ev.target.checked)} />
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

          <label>
            Note
            <textarea rows={3} maxLength={1000} value={notes} onChange={(ev) => setNotes(ev.target.value)} />
          </label>
        </fieldset>

        {error && <p className="error">{error}</p>}
        {canEdit && (
          <div className="actions">
            <button disabled={busy}>{busy ? 'Salvataggio…' : 'Salva'}</button>
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

function roundToNextHour(date: Date): Date {
  const d = new Date(date)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}
