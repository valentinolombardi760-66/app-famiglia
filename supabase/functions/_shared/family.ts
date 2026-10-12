// Validation for family-admin requests, shared with the web app so both
// reject the same input with the same message.

export const MIN_PASSWORD_LENGTH = 8

export type FamilyRequest =
  | { action: 'create'; name: string; email: string; role: 'genitore' | 'figlio'; password: string }
  | { action: 'set_password'; member_id: string; password: string }
  | { action: 'delete'; member_id: string }

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`
  }
  return null
}

/** Returns the request if valid, or an error message in Italian. */
export function parseFamilyRequest(body: unknown): FamilyRequest | string {
  if (typeof body !== 'object' || body === null) return 'Richiesta non valida.'
  const b = body as Record<string, unknown>
  switch (b.action) {
    case 'create': {
      const name = typeof b.name === 'string' ? b.name.trim() : ''
      const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
      if (!name) return 'Manca il nome.'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Email non valida.'
      if (b.role !== 'genitore' && b.role !== 'figlio') return 'Ruolo non valido.'
      return passwordProblem(b.password) ?? { action: 'create', name, email, role: b.role, password: b.password as string }
    }
    case 'set_password':
      if (typeof b.member_id !== 'string') return 'Persona non indicata.'
      return passwordProblem(b.password) ?? { action: 'set_password', member_id: b.member_id, password: b.password as string }
    case 'delete':
      if (typeof b.member_id !== 'string') return 'Persona non indicata.'
      return { action: 'delete', member_id: b.member_id }
    default:
      return 'Azione sconosciuta.'
  }
}
