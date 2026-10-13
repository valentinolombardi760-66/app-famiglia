import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Member, Role } from '../lib/types'
import { currentPushState, disablePush, enablePush, type PushState } from '../lib/push'
import { familyAdmin } from '../lib/family'
import { MODES, THEMES, loadLook, saveLook, type Look } from '../lib/theme'
import { MIN_PASSWORD_LENGTH, passwordProblem } from '../../supabase/functions/_shared/family.ts'

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
            Le notifiche sono bloccate. Riattivale dalle impostazioni del telefono: App › Chrome (o OnlyFam.ly) › Notifiche.
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

      <Aspetto />

      <CambiaPassword />

      {me.role === 'genitore' && <Famiglia me={me} members={members} onChanged={onMembersChanged} />}

      <button className="secondary" onClick={signOut}>
        Esci
      </button>
    </section>
  )
}

function Aspetto() {
  const [look, setLook] = useState<Look>(loadLook)

  function change(next: Partial<Look>) {
    const updated = { ...look, ...next }
    setLook(updated)
    saveLook(updated)
  }

  return (
    <div className="card stack">
      <div>
        <h2>Aspetto</h2>
        <p className="muted small">Vale solo su questo telefono: ognuno sceglie il suo.</p>
      </div>
      <div className="themes" role="group" aria-label="Tema">
        {THEMES.map((t) => (
          <button
            key={t.key}
            className={look.theme === t.key ? 'theme-option on' : 'theme-option'}
            aria-pressed={look.theme === t.key}
            onClick={() => change({ theme: t.key })}
          >
            <span className="swatch" style={{ background: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})` }} />
            {t.label}
          </button>
        ))}
      </div>
      <div className="segmented wide" role="group" aria-label="Chiaro o scuro">
        {MODES.map((m) => (
          <button
            key={m.key}
            className={look.mode === m.key ? 'on' : ''}
            aria-pressed={look.mode === m.key}
            onClick={() => change({ mode: m.key })}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function CambiaPassword() {
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const problem = passwordProblem(password)
    if (problem) return setMessage({ ok: false, text: problem })
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setMessage({ ok: false, text: `Errore: ${error.message}` })
    else {
      setPassword('')
      setMessage({ ok: true, text: 'Password cambiata.' })
    }
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h2>La mia password</h2>
      <label>
        Nuova password
        <input
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button>Cambia password</button>
      {message && <p className={message.ok ? '' : 'error'}>{message.text}</p>}
    </form>
  )
}

function Famiglia({ me, members, onChanged }: { me: Member; members: Member[]; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('figlio')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function run(action: () => Promise<string | null>, success: string) {
    setBusy(true)
    setMessage(null)
    const error = await action()
    setBusy(false)
    setMessage(error ? { ok: false, text: error } : { ok: true, text: success })
    if (!error) onChanged()
    return !error
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    const ok = await run(
      () => familyAdmin({ action: 'create', name, email, role, password }),
      `${name.trim()} aggiunto. Comunicagli email e password per entrare.`,
    )
    if (ok) {
      setName('')
      setEmail('')
      setPassword('')
    }
  }

  async function resetPassword(m: Member) {
    const newPassword = prompt(`Nuova password per ${m.name} (almeno ${MIN_PASSWORD_LENGTH} caratteri):`)
    if (newPassword === null) return
    await run(
      () => familyAdmin({ action: 'set_password', member_id: m.id, password: newPassword }),
      `Password di ${m.name} cambiata.`,
    )
  }

  async function remove(m: Member) {
    if (!confirm(`Togliere ${m.name} dalla famiglia? I suoi impegni verranno eliminati.`)) return
    await run(() => familyAdmin({ action: 'delete', member_id: m.id }), `${m.name} tolto dalla famiglia.`)
  }

  async function recolor(m: Member, color: string) {
    const { error } = await supabase.from('members').update({ color }).eq('id', m.id)
    if (error) setMessage({ ok: false, text: `Errore: ${error.message}` })
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
            <span className="member-actions">
              {m.id !== me.id && (
                <button className="link" disabled={busy} onClick={() => resetPassword(m)}>
                  Password
                </button>
              )}
              {m.id !== me.id && (
                <button className="link danger" disabled={busy} onClick={() => remove(m)}>
                  Togli
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {message && <p className={message.ok ? '' : 'error'}>{message.text}</p>}
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
          Password iniziale
          <input
            type="text"
            autoComplete="off"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Ruolo
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="figlio">Figlio</option>
            <option value="genitore">Genitore</option>
          </select>
        </label>
        <button disabled={busy}>{busy ? 'Attendi…' : 'Aggiungi'}</button>
      </form>
    </div>
  )
}
