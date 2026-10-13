import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Chore, ChoreSchedule, Member } from '../lib/types'
import { WEEKDAYS_SHORT } from '../lib/dates'

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
    setBusy(true)
    setError(null)
    const row = {
      title: name,
      schedule,
      weekdays: schedule === 'days' || schedule === 'weekly' ? weekdays : null,
      due_on: schedule === 'once' ? dueOn : null,
    }
    const { error } = chore
      ? await supabase.from('chores').update({ ...row, assigned_to: assignees[0] }).eq('id', chore.id)
      : await supabase
          .from('chores')
          .insert(assignees.map((id) => ({ ...row, assigned_to: id, starts_on: today, created_by: me.id })))
    setBusy(false)
    if (error) return setError('Non è stato possibile salvare. Controlla la connessione e riprova.')
    onClose(true)
  }

  async function remove() {
    if (!chore || !confirm('Eliminare questa faccenda? Si perde anche lo storico di quando è stata fatta.')) return
    setBusy(true)
    const { error } = await supabase.from('chores').delete().eq('id', chore.id)
    setBusy(false)
    if (error) return setError('Non è stato possibile eliminare. Controlla la connessione e riprova.')
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
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {chore && (
          <button type="button" className="danger" disabled={busy} onClick={remove}>
            Elimina
          </button>
        )}
        <button disabled={busy}>{busy ? 'Salvo…' : 'Salva'}</button>
      </div>
    </form>
  )
}
