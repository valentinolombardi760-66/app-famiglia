// Turns database and network errors into short Italian messages.

interface ErrorLike {
  message?: string
  code?: string
}

export function friendlyError(error: unknown, action = 'salvare'): string {
  const e = (error ?? {}) as ErrorLike
  const message = e.message ?? String(error ?? '')
  if (!navigator.onLine || /fetch|network|Load failed/i.test(message)) {
    return `Non è stato possibile ${action}: manca la connessione. Riprova tra poco.`
  }
  if (e.code === '42501' || /permission|row-level security|non modificabile/i.test(message)) {
    return `Non hai il permesso di ${action} questo elemento.`
  }
  if (e.code === '23514' || e.code === '22023') {
    return `Non è stato possibile ${action}: controlla i dati inseriti.`
  }
  return `Non è stato possibile ${action}. Riprova.`
}
