import { supabase } from './supabase'
import type { FamilyRequest } from '../../supabase/functions/_shared/family.ts'

/** Calls the family-admin function; returns an error message or null. */
export async function familyAdmin(request: FamilyRequest): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('family-admin', { body: request })
  if (!error) return null
  // Non-2xx responses carry our Italian message in the JSON body.
  const body = await (error as { context?: Response }).context?.json?.().catch(() => null)
  return body?.error ?? data?.error ?? 'Operazione non riuscita. Controlla la connessione.'
}
