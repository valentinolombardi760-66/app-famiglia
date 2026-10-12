# Famiglia

App per la famiglia, da installare sui telefoni: calendario degli impegni con
promemoria, e presto spese, paghette e faccende di casa.

- **Configurazione iniziale:** [docs/CONFIGURAZIONE.md](docs/CONFIGURAZIONE.md)
- **Progetto e decisioni:** discussi nel progetto Claude "app gestione famiglia".

## Come è fatta

| Parte | Dove |
|---|---|
| App (React + Vite, installabile come PWA) | `src/` |
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
