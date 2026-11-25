# Ripristinare un backup

Ogni lunedì notte GitHub salva una copia cifrata di tutti i dati della famiglia
(**Actions › Backup settimanale**, file `backup-AAAA-MM-GG.sql.gpg`, conservato 90 giorni).
Questa pagina dice come rimetterla in un database. **Non è ancora stata provata su un
progetto reale:** la prima volta fatelo su un progetto Supabase di prova, non su quello vero.

Se qualcosa non torna, fermati e chiedi a Claude nel progetto: con il file e la frase segreta
può guidarti passo per passo.

## Cosa serve

- La frase segreta `BACKUP_PASSPHRASE` (quella che hai inventato in configurazione).
  **Senza, il backup non si può aprire.** Tienila anche fuori da GitHub (es. nel gestore password).
- Un computer con `gpg` e `psql` (o la Supabase CLI), oppure l'aiuto di Claude.

## Passi

1. **Scarica il backup.** GitHub › Actions › *Backup settimanale* › l'esecuzione della data
   che vuoi › in fondo, *Artifacts* › scarica lo zip ed estrai il file `.sql.gpg`.
2. **Decifralo:**
   ```bash
   gpg --decrypt backup-AAAA-MM-GG.sql.gpg > backup.sql
   ```
   Ti chiede la frase segreta.
3. **Prepara il database di destinazione.** Su un progetto Supabase nuovo (o di prova):
   collega il repository e lancia *Actions › Pubblica*, così crea tabelle e regole
   (vedi `docs/CONFIGURAZIONE.md`, punti 1, 3 e 5). Il database deve essere vuoto di dati.
4. **Carica i dati**, con la stringa di connessione da *Project Settings › Database*:
   ```bash
   psql "postgresql://postgres:<password>@<host>:5432/postgres" -f backup.sql
   ```
5. **Controlla gli accessi.** Il backup contiene i dati dell'app (membri, impegni, faccende,
   spese, paghette). Se nel nuovo progetto i login non funzionano, crea di nuovo l'account
   del primo genitore (*Authentication › Users › Add user*, stessa email di prima): gli altri
   possono avere una nuova password da *Altro › Famiglia › Password*, e il resto dei dati
   torna da solo perché è collegato all'email.
6. **Notifiche:** ognuno deve riattivarle da *Altro › Notifiche su questo telefono*.

## Perché il backup non si ferma

GitHub spegne i lavori programmati dei repository pubblici dopo 60 giorni senza modifiche.
Il backup, alla fine di ogni esecuzione, si riaccende da solo per altri 60 giorni.
Se un lunedì fallisce, GitHub manda un'email al proprietario del repository.
