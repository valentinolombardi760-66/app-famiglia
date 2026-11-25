# OnlyFam.ly

App per la famiglia, da installare sui telefoni: una schermata "Oggi" con quello
che conta adesso, calendario degli impegni (anche sport e visite, con chi
accompagna e cosa portare) con promemoria e avviso delle sovrapposizioni, spese
di casa settimanali (solo genitori), paghette dei figli e faccende di casa
assegnate ai figli, con promemoria alle 19:00 se non sono fatte.

- **Configurazione iniziale:** [docs/CONFIGURAZIONE.md](docs/CONFIGURAZIONE.md)
- **Ripristinare un backup:** [docs/RIPRISTINO.md](docs/RIPRISTINO.md)
- **Prova sul telefono dopo un aggiornamento:** [docs/TEST.md](docs/TEST.md)
- **Progetto e decisioni:** discussi nel progetto Claude "app gestione famiglia".

## Come è fatta

| Parte | Dove |
|---|---|
| App (React + Vite, installabile come PWA) | `src/pages/` schermate, `src/components/` pezzi riusati, `src/lib/` dati e logica |
| Database e regole di accesso (Supabase / Postgres) | `supabase/migrations/` |
| Invio dei promemoria (Supabase Edge Function) | `supabase/functions/send-reminders/` |
| Logica delle ripetizioni e dei promemoria, condivisa | `supabase/functions/_shared/` |
| Pubblicazione, controlli, backup | `.github/workflows/` |

Chi può fare cosa è deciso nel database (row level security), non nell'app:
i genitori vedono e modificano tutto, i figli vedono il calendario e modificano
solo gli impegni creati da loro.

## Sviluppo

```bash
npm ci
cp .env.example .env.local   # e compila i valori
npm run dev
```

Controlli (gli stessi che girano su GitHub a ogni modifica):

```bash
npm run typecheck
npm test                     # ripetizioni e promemoria
PGHOST=... npm run test:db   # regole di accesso, su un Postgres di prova
```
