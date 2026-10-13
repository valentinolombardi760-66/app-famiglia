// Sends calendar and chore reminders as push notifications.
// Called every 5 minutes by pg_cron (see migrations/*_reminders_schedule.sql).
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (set by the "Configura notifiche"
// GitHub workflow); SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are built in.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import webpush from 'npm:web-push@3.6.7'
import { completionKey, dueChoreReminders, type Chore } from '../_shared/chores.ts'
import { dueReminders, type ReminderEvent } from '../_shared/reminders.ts'

// Overlaps the 5-minute schedule so a late run doesn't miss anything;
// sent_reminders makes the overlap harmless.
const WINDOW_MS = 15 * 60_000
const LOOKAHEAD_MS = 2 * 86_400_000

// No authentication: calling it more often than scheduled is harmless, since
// it only sends reminders that are due and not sent yet, and returns no data.
Deno.serve(async () => {
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:famiglia@example.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const now = new Date()
  const windowStart = new Date(now.getTime() - WINDOW_MS)
  const horizon = new Date(now.getTime() + LOOKAHEAD_MS).toISOString()
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)

  const columns =
    'id, title, all_day, location, starts_at, ends_at, recurrence, recurrence_weekdays, recurrence_until, reminder_minutes, remind_evening_before, event_members(member_id)'
  const [oneOff, repeating, choreRows, completionRows] = await Promise.all([
    db.from('events').select(columns).eq('recurrence', 'none').gte('starts_at', windowStart.toISOString()).lte('starts_at', horizon),
    db.from('events').select(columns).neq('recurrence', 'none').lte('starts_at', horizon)
      .or(`recurrence_until.is.null,recurrence_until.gte.${yesterday}`),
    db.from('chores').select('id, title, assigned_to, schedule, weekdays, due_on, starts_on'),
    db.from('chore_completions').select('chore_id, due_on').gte('due_on', yesterday),
  ])
  const failed = oneOff.error ?? repeating.error ?? choreRows.error ?? completionRows.error
  if (failed) return Response.json({ error: failed.message }, { status: 500 })

  type Row = ReminderEvent & { event_members: { member_id: string }[] }
  const events = [...(oneOff.data ?? []), ...(repeating.data ?? [])] as unknown as Row[]
  const done = new Set((completionRows.data ?? []).map((c) => completionKey(c.chore_id, c.due_on)))

  // recipients null = the whole family.
  type Outgoing = { key: string; title: string; body: string; url: string; recipients: Set<string> | null }
  const due: Outgoing[] = [
    ...dueReminders(events, windowStart, now).map((r) => {
      const event = events.find((e) => e.id === r.eventId)!
      const members = event.event_members.map((m) => m.member_id)
      // An event for nobody in particular is for the whole family.
      return { ...r, url: './#calendario', recipients: members.length > 0 ? new Set(members) : null }
    }),
    ...dueChoreReminders((choreRows.data ?? []) as Chore[], done, windowStart, now).map((r) => ({
      ...r,
      url: './#faccende',
      recipients: new Set([r.assignedTo]),
    })),
  ]
  if (due.length === 0) return Response.json({ sent: 0 })

  // Claim the reminders first: only keys inserted by this run get sent, so two
  // overlapping runs can never notify twice.
  const claimed = await db
    .from('sent_reminders')
    .upsert(due.map((d) => ({ key: d.key })), { onConflict: 'key', ignoreDuplicates: true })
    .select('key')
  if (claimed.error) return Response.json({ error: claimed.error.message }, { status: 500 })
  const claimedKeys = new Set((claimed.data ?? []).map((r) => r.key))

  const { data: subs, error: subsError } = await db.from('push_subscriptions').select('id, member_id, endpoint, p256dh, auth')
  if (subsError) return Response.json({ error: subsError.message }, { status: 500 })

  let sent = 0
  const gone: string[] = []
  for (const reminder of due.filter((d) => claimedKeys.has(d.key))) {
    const targets = (subs ?? []).filter((s) => reminder.recipients === null || reminder.recipients.has(s.member_id))
    const payload = JSON.stringify({ title: reminder.title, body: reminder.body, tag: reminder.key, url: reminder.url })
    for (const s of targets) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 3600,
        })
        sent++
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        // 404/410: the phone unsubscribed or the app was uninstalled.
        if (status === 404 || status === 410) gone.push(s.id)
        else console.error('push failed', status, err)
      }
    }
  }
  if (gone.length > 0) await db.from('push_subscriptions').delete().in('id', gone)

  return Response.json({ sent, removed: gone.length })
})
