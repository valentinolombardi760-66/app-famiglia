import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isConfigured, supabase } from './lib/supabase'
import type { Member } from './lib/types'
import { Login } from './pages/Login'
import { Calendario } from './pages/Calendario'
import { Impostazioni } from './pages/Impostazioni'
import { Faccende, MieFaccende } from './pages/Faccende'
import { MiaPaghetta, Spese } from './pages/Spese'

type Tab = 'calendario' | 'spese' | 'faccende' | 'impostazioni'
const TABS: Tab[] = ['calendario', 'spese', 'faccende', 'impostazioni']

function tabFromHash(): Tab {
  const t = location.hash.replace('#', '') as Tab
  return TABS.includes(t) ? t : 'calendario'
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [tab, setTab] = useState<Tab>(tabFromHash)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => {
      data.subscription.unsubscribe()
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  const loadMembers = useCallback(async () => {
    const { data, error } = await supabase.from('members').select('id, email, name, role, color').order('created_at')
    setMembers(error ? [] : (data as Member[]))
  }, [])

  useEffect(() => {
    if (session) void loadMembers()
    else setMembers(null)
  }, [session, loadMembers])

  if (!isConfigured) {
    return (
      <main className="centered">
        <h1>App non configurata</h1>
        <p>Mancano gli indirizzi del database. Vedi docs/CONFIGURAZIONE.md.</p>
      </main>
    )
  }
  if (session === undefined) return <main className="centered">Caricamento…</main>
  if (!session) return <Login />
  if (members === null) return <main className="centered">Caricamento…</main>

  const email = session.user.email?.toLowerCase()
  const me = members.find((m) => m.email.toLowerCase() === email)
  if (!me) {
    return (
      <main className="centered">
        <h1>Accesso non autorizzato</h1>
        <p>
          L'indirizzo <strong>{session.user.email}</strong> non fa parte della famiglia. Chiedi a un genitore di
          aggiungerti dalle Impostazioni.
        </p>
        <button className="secondary" onClick={() => supabase.auth.signOut()}>
          Esci
        </button>
      </main>
    )
  }

  const go = (t: Tab) => {
    location.hash = t
    setTab(t)
  }

  return (
    <div className="app">
      <main className="content">
        {tab === 'calendario' && <Calendario me={me} members={members} />}
        {tab === 'spese' &&
          (me.role === 'genitore' ? <Spese me={me} members={members} /> : <MiaPaghetta me={me} />)}
        {tab === 'faccende' &&
          (me.role === 'genitore' ? <Faccende me={me} members={members} /> : <MieFaccende me={me} />)}
        {tab === 'impostazioni' && <Impostazioni me={me} members={members} onMembersChanged={loadMembers} />}
      </main>
      <nav className="tabbar">
        <TabButton active={tab === 'calendario'} onClick={() => go('calendario')} icon="📅" label="Calendario" />
        <TabButton
          active={tab === 'spese'}
          onClick={() => go('spese')}
          icon="💶"
          label={me.role === 'genitore' ? 'Spese' : 'Paghetta'}
        />
        <TabButton active={tab === 'faccende'} onClick={() => go('faccende')} icon="🧹" label="Faccende" />
        <TabButton active={tab === 'impostazioni'} onClick={() => go('impostazioni')} icon="⚙️" label="Impostazioni" />
      </nav>
    </div>
  )
}

function TabButton(props: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button className={props.active ? 'tab active' : 'tab'} onClick={props.onClick} aria-current={props.active}>
      <span aria-hidden>{props.icon}</span>
      <span>{props.label}</span>
    </button>
  )
}
