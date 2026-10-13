# Configurazione (da fare una volta sola)

Questi passaggi collegano il codice a un database gratuito e pubblicano l'app.
Servono circa 30 minuti. Se un passaggio non è chiaro, chiedi a Claude nel progetto.

Cosa ti serve alla fine: un indirizzo come `https://valentinolombardi760-66.github.io/app-famiglia/`
da aprire con Chrome su ogni telefono.

## 1. Crea il database su Supabase

1. Vai su <https://supabase.com>, entra con il tuo account GitHub e crea un progetto:
   - **Name:** `app-famiglia`
   - **Database password:** premi *Generate* e **salvala** (ti serve al punto 3).
   - **Region:** una in Europa (es. Frankfurt).
   - Piano **Free**.
2. A progetto creato, apri **Project Settings › API** (o *API Keys*) e annota:
   - **Project URL** (es. `https://abcdefgh.supabase.co`)
   - la parte `abcdefgh` è il **Project ref**
   - la chiave **anon / public** (o *publishable*). È pubblica per costruzione: può stare nell'app.
     La chiave *service_role* / *secret* invece **non va mai copiata da nessuna parte**.
3. Crea un token per la pubblicazione automatica: in alto a destra, avatar ›
   **Account preferences › Access Tokens › Generate new token**, nome `github`, scadenza *Never*.
   Se il modulo chiede i permessi, limita il token al progetto `app-famiglia` e scegli:
   - *Read*: Project Settings, API Keys, API Key Secrets, Connection Pooling (la voce sul *pooling*)
   - *Read-write*: Database, Migrations, Edge Functions, Edge Function Secrets

   Supabase lo mostra una volta sola: copialo subito nel segreto GitHub del punto 3.

## 2. Accesso con email e password

Gli account li crea un genitore dall'app: nessuno può registrarsi da solo e non parte nessuna email.

In Supabase, **Authentication › Sign In / Providers › Email** (il nome del menu può variare leggermente):

1. **Allow new users to sign up**: spento.
2. **Confirm email**: spento.
3. Salva.

## 3. Segreti e variabili su GitHub

Nel repository: **Settings › Secrets and variables › Actions**.

Scheda **Secrets** (*New repository secret*):

| Nome | Valore |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | il token del punto 1.3 |
| `SUPABASE_DB_PASSWORD` | la password del database del punto 1.1 |
| `BACKUP_PASSPHRASE` | una frase lunga che inventi tu e **conservi** (serve per leggere i backup) |

Scheda **Variables** (*New repository variable*):

| Nome | Valore |
|---|---|
| `SUPABASE_PROJECT_REF` | il Project ref (es. `abcdefgh`) |
| `VITE_SUPABASE_URL` | il Project URL |
| `VITE_SUPABASE_ANON_KEY` | la chiave anon / publishable |

## 4. Rendi pubblico il repository e attiva GitHub Pages

1. **Settings › General › Danger Zone › Change visibility › Public**.
   Nel codice non ci sono dati della famiglia né password: stanno solo nel database.
2. **Settings › Pages › Build and deployment › Source: GitHub Actions**.

## 5. Prima pubblicazione

1. **Actions › Pubblica › Run workflow**. Crea le tabelle nel database e pubblica l'app.
2. **Actions › Configura notifiche › Run workflow**, scrivi `CREA` e avvia.
   Al termine apri l'esecuzione: in fondo trovi la **chiave pubblica**.
   Copiala in una nuova variabile `VITE_VAPID_PUBLIC_KEY` (scheda *Variables* del punto 3).
3. **Actions › Pubblica › Run workflow** di nuovo, così l'app conosce la chiave.

## 6. Il primo genitore e l'ultimo collegamento

1. In Supabase, **Authentication › Users › Add user › Create new user**: la tua email e una password
   (almeno 8 caratteri), con **Auto Confirm User** attivo.
2. Apri **SQL Editor**, incolla questo testo, sostituisci i valori tra `<>` e premi *Run*:

```sql
-- Indirizzo del progetto, usato per i promemoria automatici
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');

-- Il primo genitore (la stessa email del punto 1).
-- Gli altri li aggiungi dall'app: Impostazioni › Famiglia.
insert into public.members (name, email, role, color)
values ('<Nome>', '<email>', 'genitore', '#2f6f4f');
```

## 7. Installare l'app sui telefoni

Su ogni telefono Android:

1. Apri l'indirizzo dell'app con **Chrome**.
2. Menu ⋮ › **Installa app** (o *Aggiungi a schermata Home*).
3. Apri l'app dall'icona ed entra con email e password.
4. **Impostazioni › Attiva notifiche** e accetta.

Il primo genitore aggiunge gli altri da **Impostazioni › Famiglia**, scegliendo per ognuno una password
iniziale da comunicargli. Ognuno può poi cambiarla da **Impostazioni › La mia password**.
Se qualcuno la dimentica, un genitore gliene imposta una nuova con **Password** accanto al suo nome.

## Cosa succede da solo, dopo

- **Ogni modifica approvata** sul ramo `main` viene pubblicata in automatico (database, promemoria, app).
- **Promemoria:** ogni 5 minuti il database controlla se ci sono avvisi da mandare.
- **Backup:** ogni lunedì notte una copia cifrata di tutti i dati, conservata 90 giorni in **Actions › Backup settimanale**.

Due cose da sapere:

- Se il repository non riceve modifiche per 60 giorni, GitHub sospende il backup settimanale e manda un'email:
  basta riattivarlo da **Actions**.
- Supabase mette in pausa i progetti gratuiti inutilizzati per una settimana.
  I controlli dei promemoria ogni 5 minuti dovrebbero bastare a tenerlo attivo; se ricevete un'email di pausa,
  riattivatelo dalla dashboard di Supabase.
