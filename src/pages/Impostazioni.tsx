import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Member, Role } from '../lib/types'
import { currentPushState, disablePush, enablePush, type PushState } from '../lib/push'

const COLORS = ['#2f6f4f', '#c0392b', '#2471a3', '#d68910', '#7d3c98', '#17a589', '#a04000', '#5d6d7e']

interface Props {
  me: Member
  members: Member[]
  onMembersChanged: () => void
}

export function Impostazioni({ me, members, onMembersChanged }: Props) {
  const [push, setPush] = useState<PushState | null>(null)
  const [pushError, setPushError] = useState<string | null>(null)

  useEffect(() => {
    void currentPushState().then(setPush)
  }, [])

  async function togglePush() {
    setPushError(null)
    try {
      if (push === 'on') {
        await disablePush()
        setPush('off')
      } else {
        setPush(await enablePush(me.id))
      }
    } catch (err) {
      setPushError(`Non è stato possibile attivare le notifiche: ${(err as Error).message}`)
    }
  }

  async function signOut() {
    await disablePush().catch(() => undefined)
    await supabase.auth.signOut()
  }

  return (
    <section className="stack">
      <h1>Impostazioni</h1>
      <p>
        Sei entrato come <strong>{me.name}</strong> ({me.role}).
      </p>

      <div className="card">
        <h2>Notifiche su questo telefono</h2>
        {push === null && <p className="muted">Controllo…</p>}
        {push === 'unsupported' && (
          <p className="muted">
            Questo browser non supporta le notifiche. Apri l'app da Chrome e installala sulla schermata Home.
          </p>
        )}
        {push === 'denied' && (
          <p className="muted">
            Le notifiche sono bloccate. Riattivale dalle impostazioni del telefono: App › Chrome (o Famiglia) › Notifiche.
          </p>
        )}
        {(push === 'on' || push === 'off') && (
          <>
            <p>{push === 'on' ? 'Attive: riceverai i promemoria.' : 'Spente: non riceverai promemoria.'}</p>
            <button className={push === 'on' ? 'secondary' : ''} onClick={togglePush}>
              {push === 'on' ? 'Disattiva notifiche' : 'Attiva notifiche'}
            </button>
          </>
        )}
        {pushError && <p className="error">{pushError}</p>}
      </div>

      {me.role === 'genitore' && <Famiglia me={me} members={members} onChanged={onMembersChanged} />}

      <button className="secondary" onClick={signOut}>
        Esci
      </button>
    </section>
  )
}

function Famiglia({ me, members, onChanged }: { me: Member; members: Member[]; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('figlio')
  const [error, setError] = useState<string | null>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const color = COLORS[members.length % COLORS.length]
    const { error } = await supabase.from('members').insert({ name: name.trim(), email: email.trim().toLowerCase(), role, color })
    if (error) {
      setError(error.code === '23505' ? 'Questa email è già nella famiglia.' : `Errore: ${error.message}`)
      return
    }
    setName('')
    setEmail('')
    onChanged()
  }

  async function remove(m: Member) {
    if (!confirm(`Togliere ${m.name} dalla famiglia? I suoi impegni verranno eliminati.`)) return
    const { error } = await supabase.from('members').delete().eq('id', m.id)
    if (error) setError(`Errore: ${error.message}`)
    else onChanged()
  }

  async function recolor(m: Member, color: string) {
    const { error } = await supabase.from('members').update({ color }).eq('id', m.id)
    if (error) setError(`Errore: ${error.message}`)
    else onChanged()
  }

  return (
    <div className="card">
      <h2>Famiglia</h2>
      <ul className="members">
        {members.map((m) => (
          <li key={m.id}>
            <input
              type="color"
              aria-label={`Colore di ${m.name}`}
              value={m.color}
              onChange={(e) => recolor(m, e.target.value)}
            />
            <span>
              <strong>{m.name}</strong> · {m.role}
              <br />
              <span className="muted small">{m.email}</span>
            </span>
            {m.id !== me.id && (
              <button className="link danger" onClick={() => remove(m)}>
                Togli
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="stack">
        <h3>Aggiungi una persona</h3>
        <label>
          Nome
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Email con cui entrerà
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Ruolo
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="figlio">Figlio</option>
            <option value="genitore">Genitore</option>
          </select>
        </label>
        <button>Aggiungi</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
