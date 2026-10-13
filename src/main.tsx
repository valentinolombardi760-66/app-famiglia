import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyLook, loadLook } from './lib/theme'
import './styles.css'

// Before the first render, so the chosen colors never flash.
applyLook(loadLook())
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyLook(loadLook()))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
