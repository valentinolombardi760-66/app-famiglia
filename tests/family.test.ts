import { describe, expect, it } from 'vitest'
import { parseFamilyRequest } from '../supabase/functions/_shared/family.ts'

describe('parseFamilyRequest', () => {
  it('normalizes a valid new member', () => {
    expect(
      parseFamilyRequest({ action: 'create', name: ' Diego ', email: ' Diego@Example.com ', role: 'figlio', password: 'calcetto1' }),
    ).toEqual({ action: 'create', name: 'Diego', email: 'diego@example.com', role: 'figlio', password: 'calcetto1' })
  })

  it('rejects short passwords, bad emails, roles and actions', () => {
    const base = { action: 'create', name: 'Diego', email: 'diego@example.com', role: 'figlio', password: 'calcetto1' }
    expect(parseFamilyRequest({ ...base, password: 'corta' })).toMatch(/almeno 8/)
    expect(parseFamilyRequest({ ...base, email: 'diego' })).toBe('Email non valida.')
    expect(parseFamilyRequest({ ...base, role: 'admin' })).toBe('Ruolo non valido.')
    expect(parseFamilyRequest({ ...base, name: '  ' })).toBe('Manca il nome.')
    expect(parseFamilyRequest({ action: 'drop' })).toBe('Azione sconosciuta.')
    expect(parseFamilyRequest(null)).toBe('Richiesta non valida.')
  })

  it('accepts password resets and removals for a member', () => {
    expect(parseFamilyRequest({ action: 'set_password', member_id: 'm2', password: 'nuovapass' })).toEqual({
      action: 'set_password',
      member_id: 'm2',
      password: 'nuovapass',
    })
    expect(parseFamilyRequest({ action: 'set_password', member_id: 'm2', password: '123' })).toMatch(/almeno 8/)
    expect(parseFamilyRequest({ action: 'delete', member_id: 'm2' })).toEqual({ action: 'delete', member_id: 'm2' })
    expect(parseFamilyRequest({ action: 'delete' })).toBe('Persona non indicata.')
  })
})
