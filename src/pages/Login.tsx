import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

// Login with a one-time code sent by email: no password to remember, and the
// code is typed inside the installed app, so the session stays in the app.
export function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() })
    setBusy(false)
    if (error) setError(`Invio non riuscito: ${error.message}`)
    else setStep('code')
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setError('Codice non valido o scaduto. Riprova o fatti mandare un nuovo codice.')
  }

  return (
    <main className="centered login">
      <img src="icons/icon-192.png" alt="" width={72} height={72} />
      <h1>Famiglia</h1>
      {step === 'email' ? (
        <form onSubmit={sendCode}>
          <label>
            La tua email
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button disabled={busy}>{busy ? 'Invio…' : 'Mandami il codice'}</button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p className="muted">Ti abbiamo mandato un codice a {email}. Scrivilo qui sotto.</p>
          <label>
            Codice
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button disabled={busy}>{busy ? 'Verifica…' : 'Entra'}</button>
          <button type="button" className="link" onClick={() => setStep('email')}>
            Cambia email
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  )
}
