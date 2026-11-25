import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Chore, ChoreSchedule, Member } from '../lib/types'
import { WEEKDAYS_SHORT } from '../lib/dates'
import { addDaysKey } from '../lib/money'
import { friendlyError } from '../lib/errors'
import { useUi } from '../components/ui'

const SCHEDULES: { key: ChoreSchedule; label: string }[] = [
  { key: 'daily', label: 'Ogni giorno' },
  { key: 'days', label: 'Alcuni giorni' },
  { key: 'weekly', label: 'Una volta a settimana' },
  { key: 'once', label: 'Una volta sola' },
]

interface Props {
  me: Member
  sons: Member[]
  chore: Chore | null
  today: string
  onClose: (changed: boolean) => void
}

export function ChoreForm({ me, sons, chore, today, onClose }: Props) {
  const [title, setTitle] = useState(chore?.title ?? '')
  // A new chore can go to several sons at once (one copy each); an existing one belongs to one.
  const [assignees, setAssignees] = useState<string[]>(
    chore ? [chore.assigned_to] : sons.length === 1 ? [sons[0].id] : [],
  )
  const [schedule, setSchedule] = useState<ChoreSchedule>(chore?.schedule ?? 'daily')
  const [weekdays, setWeekdays] = useState<number[]>(chore?.weekdays ?? [])
  const [dueOn, setDueOn] = useState(chore?.due_on ?? today)
  const [endsOn, setEndsOn] = useState(chore?.ends_on ?? '')
  const ui = useUi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pickSon(id: string) {
    if (chore) return setAssignees([id])
    setAssignees((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function pickDay(day: number) {
    if (schedule === 'weekly') return setWeekdays([day])
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()))
  }

  function pickSchedule(s: ChoreSchedule) {
    setSchedule(s)
    // "Weekly" has a single deadline day.
    if (s === 'weekly' && weekdays.length > 1) setWeekdays([])
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const name = title.trim()
    if (!name) return setError('Scrivi cosa c\'è da fare.')
    if (assignees.length === 0) return setError('Scegli a chi tocca.')
    if (schedule === 'days' && weekdays.length === 0) return setError('Scegli almeno un giorno.')
    if (schedule === 'weekly' && weekdays.length !== 1) return setError('Scegli entro che giorno va fatta.')
    if (schedule === 'once' && !dueOn) return setError('Scegli entro quando va fatta.')
    const endDay = schedule === 'once' ? null : endsOn || null
    if (endDay && endDay < today && !chore) return setError('"Fino al" non può essere nel passato.')
    setBusy(true)
    setError(null)
    const row = {
      title: name,
      schedule,
      weekdays: schedule === 'days' || schedule === 'weekly' ? [...weekdays].sort() : null,
      due_on: schedule === 'once' ? dueOn : null,
      ends_on: endDay,
    }
    let error
    if (!chore) {
      ;({ error } = await supabase
        .from('chores')
        .insert(assignees.map((id) => ({ ...row, assigned_to: id, starts_on: today, created_by: me.id }))))
    } else if (
      chore.assigned_to !== assignees[0] ||
      chore.schedule !== row.schedule ||
      (chore.weekdays ?? []).join() !== (row.weekdays ?? []).join() ||
      (chore.due_on ?? null) !== row.due_on
    ) {
      // Who or when changed: from today on, so past weeks keep showing what was asked then.
      ;({ error } = await supabase.rpc('change_chore_from_today', {
        p_id: chore.id,
        p_title: name,
        p_assigned_to: assignees[0],
        p_schedule: row.schedule,
        p_weekdays: row.weekdays,
        p_due_on: row.due_on,
        p_ends_on: row.ends_on,
      }))
    } else {
      ;({ error } = await supabase.from('chores').update({ title: name, ends_on: row.ends_on }).eq('id', chore.id))
    }
    setBusy(false)
    if (error) return setError(friendlyError(error))
    ui.toast(chore ? 'Faccenda aggiornata.' : assignees.length > 1 ? `Faccenda assegnata a ${assignees.length} figli.` : 'Faccenda aggiunta.')
    onClose(true)
  }

  async function archive() {
    if (!chore) return
    const previous = chore.ends_on ?? null
    setBusy(true)
    const { error } = await supabase.from('chores').update({ ends_on: addDaysKey(today, -1) }).eq('id', chore.id)
    setBusy(false)
    if (error) return setError(friendlyError(error, 'archiviare'))
    ui.toast(`«${chore.title}» archiviata: lo storico resta.`, async () => {
      await supabase.from('chores').update({ ends_on: previous }).eq('id', chore.id)
      onClose(true)
    })
    onClose(true)
  }

  async function remove() {
    if (!chore) return
    const answer = await ui.ask(
      'Eliminare la faccenda?',
      'Si perde anche lo storico di quando è stata fatta. Se non serve più, archiviala: sparisce dalle liste ma lo storico resta.',
      [
        { value: 'archive', label: 'Archivia' },
        { value: 'delete', label: 'Elimina per sempre', danger: true },
      ],
    )
    if (answer === 'archive') return archive()
    if (answer !== 'delete') return
    setBusy(true)
    const { error } = await supabase.from('chores').delete().eq('id', chore.id)
    setBusy(false)
    if (error) return setError(friendlyError(error, 'eliminare'))
    ui.toast('Faccenda eliminata.')
    onClose(true)
  }

  return (
    <form className="stack" onSubmit={save}>
      <header className="form-header">
        <button type="button" className="link" onClick={() => onClose(false)}>
          ‹ Indietro
        </button>
        <h1>{chore ? 'Modifica faccenda' : 'Nuova faccenda'}</h1>
      </header>
      <label>
        Cosa c'è da fare
        <input
          value={title}
          maxLength={80}
          required
          placeholder="Es. Svuotare la lavastoviglie"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <div className="field">
        {chore ? 'A chi tocca' : 'A chi tocca (puoi sceglierne più di uno)'}
        <div className="chips">
          {sons.map((s) => (
            <button
              type="button"
              key={s.id}
              className={assignees.includes(s.id) ? 'chip on' : 'chip'}
              aria-pressed={assignees.includes(s.id)}
              onClick={() => pickSon(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        Quando
        <div className="chips">
          {SCHEDULES.map((s) => (
            <button
              type="button"
              key={s.key}
              className={schedule === s.key ? 'chip on' : 'chip'}
              aria-pressed={schedule === s.key}
              onClick={() => pickSchedule(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {(schedule === 'days' || schedule === 'weekly') && (
        <div className="field">
          {schedule === 'days' ? 'In quali giorni' : 'Entro che giorno'}
          <div className="chips">
            {WEEKDAYS_SHORT.map((label, i) => (
              <button
                type="button"
                key={label}
                className={weekdays.includes(i + 1) ? 'chip on' : 'chip'}
                aria-pressed={weekdays.includes(i + 1)}
                onClick={() => pickDay(i + 1)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {schedule === 'once' && (
        <label>
          Entro il
          <input type="date" required value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </label>
      )}
      {schedule !== 'once' && (
        <label>
          Fino al (facoltativo, es. fine scuola)
          <input type="date" value={endsOn} min={today} onChange={(e) => setEndsOn(e.target.value)} />
        </label>
      )}
      {chore && schedule !== 'once' && chore.starts_on < today && (
        <p className="muted small">Se cambi a chi tocca o i giorni, la modifica vale da oggi: le settimane passate restano com'erano.</p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button disabled={busy}>{busy ? 'Salvo…' : 'Salva'}</button>
        {chore && (
          <button type="button" className="secondary" disabled={busy} onClick={archive}>
            Archivia
          </button>
        )}
        {chore && (
          <button type="button" className="danger" disabled={busy} onClick={remove}>
            Elimina
          </button>
        )}
      </div>
    </form>
  )
}
