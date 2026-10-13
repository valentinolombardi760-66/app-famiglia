import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Allowance, Expense, Member } from '../lib/types'
import { CATEGORIES, MAX_EURO, parseEuro, type Category } from '../lib/money'

const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

function AmountField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label>
      Importo (€)
      <input
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

const AMOUNT_ERROR = `Scrivi un importo valido, per esempio 12,50 (massimo ${MAX_EURO.toLocaleString('it-IT')} €).`

interface ExpenseProps {
  me: Member
  expense: Expense | null
  today: string
  onClose: (changed: boolean) => void
}

export function SpesaForm({ me, expense, today, onClose }: ExpenseProps) {
  const [amount, setAmount] = useState(expense ? centsToInput(expense.amount_cents) : '')
  const [category, setCategory] = useState<Category>(expense?.category ?? 'spesa')
  const [day, setDay] = useState(expense?.spent_on ?? today)
  const [note, setNote] = useState(expense?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const cents = parseEuro(amount)
    if (cents === null) return setError(AMOUNT_ERROR)
    setBusy(true)
    setError(null)
    const row = { amount_cents: cents, category, spent_on: day, note: note.trim() || null }
    const { error } = expense
      ? await supabase.from('expenses').update(row).eq('id', expense.id)
      : await supabase.from('expenses').insert({ ...row, created_by: me.id })
    setBusy(false)
    if (error) return setError('Non è stato possibile salvare. Controlla la connessione e riprova.')
    onClose(true)
  }

  async function remove() {
    if (!expense || !confirm('Eliminare questa spesa?')) return
    setBusy(true)
    const { error } = await supabase.from('expenses').delete().eq('id', expense.id)
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
        <h1>{expense ? 'Modifica spesa' : 'Nuova spesa'}</h1>
      </header>
      <AmountField value={amount} onChange={setAmount} />
      <div className="field">
        Categoria
        <div className="chips">
          {CATEGORIES.map((c) => (
            <button
              type="button"
              key={c.key}
              className={category === c.key ? 'chip on' : 'chip'}
              aria-pressed={category === c.key}
              onClick={() => setCategory(c.key)}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      </div>
      <label>
        Data
        <input type="date" required max={today} value={day} onChange={(e) => setDay(e.target.value)} />
      </label>
      <label>
        Nota
        <input value={note} maxLength={200} placeholder="Facoltativa" onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {expense && (
          <button type="button" className="danger" disabled={busy} onClick={remove}>
            Elimina
          </button>
        )}
        <button disabled={busy}>{busy ? 'Salvo…' : 'Salva'}</button>
      </div>
    </form>
  )
}

interface AllowanceProps {
  me: Member
  sons: Member[]
  allowance: Allowance | null
  today: string
  onClose: (changed: boolean) => void
}

export function PaghettaForm({ me, sons, allowance, today, onClose }: AllowanceProps) {
  const [son, setSon] = useState(allowance?.member_id ?? (sons.length === 1 ? sons[0].id : ''))
  const [amount, setAmount] = useState(allowance ? centsToInput(allowance.amount_cents) : '')
  const [day, setDay] = useState(allowance?.given_on ?? today)
  const [note, setNote] = useState(allowance?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!son) return setError('Scegli a chi hai dato la paghetta.')
    const cents = parseEuro(amount)
    if (cents === null) return setError(AMOUNT_ERROR)
    setBusy(true)
    setError(null)
    const row = { member_id: son, amount_cents: cents, given_on: day, note: note.trim() || null }
    const { error } = allowance
      ? await supabase.from('allowances').update(row).eq('id', allowance.id)
      : await supabase.from('allowances').insert({ ...row, created_by: me.id })
    setBusy(false)
    if (error) return setError('Non è stato possibile salvare. Controlla la connessione e riprova.')
    onClose(true)
  }

  async function remove() {
    if (!allowance || !confirm('Eliminare questa paghetta?')) return
    setBusy(true)
    const { error } = await supabase.from('allowances').delete().eq('id', allowance.id)
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
        <h1>{allowance ? 'Modifica paghetta' : 'Nuova paghetta'}</h1>
      </header>
      <div className="field">
        A chi
        {sons.length === 0 ? (
          <p className="muted small">Non ci sono ancora figli: aggiungili da Impostazioni › Famiglia.</p>
        ) : (
          <div className="chips">
            {sons.map((s) => (
              <button
                type="button"
                key={s.id}
                className={son === s.id ? 'chip on' : 'chip'}
                aria-pressed={son === s.id}
                onClick={() => setSon(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="row">
        <AmountField value={amount} onChange={setAmount} />
        <label>
          Data
          <input type="date" required max={today} value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
      </div>
      <label>
        Nota
        <input value={note} maxLength={200} placeholder="Facoltativa" onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {allowance && (
          <button type="button" className="danger" disabled={busy} onClick={remove}>
            Elimina
          </button>
        )}
        <button disabled={busy || sons.length === 0}>{busy ? 'Salvo…' : 'Salva'}</button>
      </div>
    </form>
  )
}
