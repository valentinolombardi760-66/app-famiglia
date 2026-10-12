// Lets a parent add family members with a password, reset a member's
// password, or remove a member. Login accounts can only be created with the
// service role, so this runs server-side and checks the caller is a parent.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { parseFamilyRequest } from '../_shared/family.ts'

const COLORS = ['#2f6f4f', '#c0392b', '#2471a3', '#d68910', '#7d3c98', '#17a589', '#a04000', '#5d6d7e']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Metodo non permesso.' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  // The platform's JWT check is off for this function (see config.toml), so
  // verify the caller's session here.
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const { data: caller, error: callerError } = await db.auth.getUser(token)
  if (callerError || !caller.user?.email) return reply({ error: 'Accesso richiesto.' }, 401)

  const { data: me } = await db
    .from('members')
    .select('id, role')
    .ilike('email', exactly(caller.user.email))
    .maybeSingle()
  if (me?.role !== 'genitore') return reply({ error: 'Solo un genitore può farlo.' }, 403)

  const request = parseFamilyRequest(await req.json().catch(() => null))
  if (typeof request === 'string') return reply({ error: request }, 400)

  if (request.action === 'create') {
    const { data: existing } = await db.from('members').select('id').ilike('email', exactly(request.email)).maybeSingle()
    if (existing) return reply({ error: 'Questa email è già nella famiglia.' }, 409)

    const created = await db.auth.admin.createUser({
      email: request.email,
      password: request.password,
      email_confirm: true,
    })
    if (created.error) {
      const taken = /already|registered|exists/i.test(created.error.message)
      return reply({ error: taken ? 'Esiste già un accesso con questa email.' : created.error.message }, taken ? 409 : 500)
    }
    const { count } = await db.from('members').select('id', { count: 'exact', head: true })
    const { error } = await db.from('members').insert({
      name: request.name,
      email: request.email,
      role: request.role,
      color: COLORS[(count ?? 0) % COLORS.length],
    })
    if (error) {
      await db.auth.admin.deleteUser(created.data.user.id)
      return reply({ error: error.message }, 500)
    }
    return reply({ ok: true })
  }

  const { data: member } = await db.from('members').select('id, email').eq('id', request.member_id).maybeSingle()
  if (!member) return reply({ error: 'Persona non trovata.' }, 404)
  const userId = await findUserId(db.auth.admin, member.email)

  if (request.action === 'set_password') {
    if (!userId) return reply({ error: 'Questa persona non ha ancora un accesso.' }, 404)
    const { error } = await db.auth.admin.updateUserById(userId, { password: request.password })
    if (error) return reply({ error: error.message }, 500)
    return reply({ ok: true })
  }

  // delete
  if (member.id === me.id) return reply({ error: 'Non puoi togliere te stesso.' }, 400)
  const { error } = await db.from('members').delete().eq('id', member.id)
  if (error) return reply({ error: error.message }, 500)
  if (userId) await db.auth.admin.deleteUser(userId)
  return reply({ ok: true })
})

// Case-insensitive exact match: escape the characters ILIKE treats as wildcards.
function exactly(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

// A family has a handful of accounts, so one page covers them all.
async function findUserId(
  admin: ReturnType<typeof createClient>['auth']['admin'],
  email: string,
): Promise<string | null> {
  const { data } = await admin.listUsers({ page: 1, perPage: 1000 })
  return data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null
}
