// Per-phone look: a color theme and light/dark mode, saved in this browser only.

export const THEMES = [
  { key: 'verde', label: 'Bosco', colors: ['#2f6f4f', '#3f9b6e'] },
  { key: 'oceano', label: 'Oceano', colors: ['#1f5fa8', '#1aa0b8'] },
  { key: 'tramonto', label: 'Tramonto', colors: ['#c2410c', '#db2777'] },
  { key: 'lavanda', label: 'Lavanda', colors: ['#6d28d9', '#c026d3'] },
  { key: 'ciliegia', label: 'Ciliegia', colors: ['#be123c', '#9333ea'] },
  { key: 'grafite', label: 'Grafite', colors: ['#374151', '#64748b'] },
] as const

export type ThemeKey = (typeof THEMES)[number]['key']
export type Mode = 'auto' | 'chiaro' | 'scuro'

export const MODES: { key: Mode; label: string }[] = [
  { key: 'auto', label: 'Automatico' },
  { key: 'chiaro', label: 'Chiaro' },
  { key: 'scuro', label: 'Scuro' },
]

export interface Look {
  theme: ThemeKey
  mode: Mode
}

const STORAGE_KEY = 'famiglia-aspetto'
const DEFAULT: Look = { theme: 'verde', mode: 'auto' }

export function loadLook(): Look {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Look> | null
    return {
      theme: THEMES.some((t) => t.key === saved?.theme) ? saved!.theme! : DEFAULT.theme,
      mode: MODES.some((m) => m.key === saved?.mode) ? saved!.mode! : DEFAULT.mode,
    }
  } catch {
    return DEFAULT
  }
}

export function saveLook(look: Look) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(look))
  } catch {
    // Private mode or full storage: the look still applies until the app is closed.
  }
  applyLook(look)
}

/** Sets the attributes styles.css keys on, and the phone's status bar color. */
export function applyLook(look: Look) {
  const root = document.documentElement
  root.dataset.theme = look.theme
  root.dataset.mode = look.mode
  const dark = look.mode === 'scuro' || (look.mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  const color = dark ? '#121417' : THEMES.find((t) => t.key === look.theme)!.colors[0]
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}
