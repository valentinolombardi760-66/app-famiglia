import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

// Accounts are created by a parent from Impostazioni, so there is no sign-up
// here; a forgotten password is reset by a parent too.
export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      setError(
        error.message.includes('Invalid login credentials')
          ? 'Email o password sbagliate.'
          : `Accesso non riuscito: ${error.message}`,
      )
    }
  }

  return (
    <main className="centered login">
      <img src="icons/icon-192.png" alt="" width={72} height={72} />
      <h1>Famiglia</h1>
      <form onSubmit={signIn}>
        <label>
          Email
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button disabled={busy}>{busy ? 'Accesso…' : 'Entra'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Password dimenticata? Chiedi a un genitore di impostarne una nuova.</p>
    </main>
  )
}
