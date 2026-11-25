// App-wide feedback: short messages with an optional "Annulla", and dialogs
// that replace the browser's confirm()/prompt() (which look foreign in an
// installed app, can't be styled and show passwords in clear).

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

interface Toast {
  id: number
  text: string
  undo?: () => void | Promise<void>
}

export interface DialogAction<T extends string> {
  value: T
  label: string
  danger?: boolean
  secondary?: boolean
}

interface DialogRequest {
  title: string
  message?: string
  actions: DialogAction<string>[]
  /** When set, the dialog has a text field and resolves with its value. */
  input?: { label: string; type?: 'text' | 'password'; minLength?: number }
  resolve: (value: { action: string; text: string } | null) => void
}

interface Ui {
  toast: (text: string, undo?: () => void | Promise<void>) => void
  ask: <T extends string>(title: string, message: string, actions: DialogAction<T>[]) => Promise<T | null>
  askText: (title: string, label: string, options?: { type?: 'text' | 'password'; minLength?: number; confirm?: string }) => Promise<string | null>
}

const UiContext = createContext<Ui | null>(null)

export function useUi(): Ui {
  const ui = useContext(UiContext)
  if (!ui) throw new Error('useUi outside UiProvider')
  return ui
}

const TOAST_MS = 6000

export function UiProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const [dialog, setDialog] = useState<DialogRequest | null>(null)
  const nextId = useRef(1)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast])

  const ui: Ui = {
    toast: useCallback((text, undo) => setToast({ id: nextId.current++, text, undo }), []),
    ask: useCallback(
      <T extends string>(title: string, message: string, actions: DialogAction<T>[]) =>
        new Promise<T | null>((resolve) =>
          setDialog({ title, message, actions, resolve: (r) => resolve((r?.action as T) ?? null) }),
        ),
      [],
    ),
    askText: useCallback(
      (title, label, options) =>
        new Promise<string | null>((resolve) =>
          setDialog({
            title,
            actions: [{ value: 'ok', label: options?.confirm ?? 'Conferma' }],
            input: { label, type: options?.type, minLength: options?.minLength },
            resolve: (r) => resolve(r ? r.text : null),
          }),
        ),
      [],
    ),
  }

  return (
    <UiContext.Provider value={ui}>
      {children}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              className="link"
              onClick={() => {
                const undo = toast.undo!
                setToast(null)
                void undo()
              }}
            >
              Annulla
            </button>
          )}
        </div>
      )}
      {dialog && <Dialog request={dialog} onDone={() => setDialog(null)} />}
    </UiContext.Provider>
  )
}

function Dialog({ request, onDone }: { request: DialogRequest; onDone: () => void }) {
  const [text, setText] = useState('')
  const finish = (action: string | null) => {
    onDone()
    request.resolve(action === null ? null : { action, text })
  }
  const tooShort = request.input?.minLength !== undefined && text.length < request.input.minLength

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && finish(null)}>
      <form
        className="dialog stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onSubmit={(e) => {
          e.preventDefault()
          if (!tooShort) finish(request.actions[0].value)
        }}
      >
        <h2 id="dialog-title">{request.title}</h2>
        {request.message && <p>{request.message}</p>}
        {request.input && (
          <label>
            {request.input.label}
            <input
              autoFocus
              type={request.input.type ?? 'text'}
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {tooShort && text.length > 0 && (
              <span className="muted small">Almeno {request.input.minLength} caratteri.</span>
            )}
          </label>
        )}
        <div className="dialog-actions">
          {request.actions.map((a, i) => (
            <button
              key={a.value}
              type={i === 0 && request.input ? 'submit' : 'button'}
              className={a.danger ? 'danger' : a.secondary ? 'secondary' : ''}
              disabled={i === 0 && tooShort}
              onClick={i === 0 && request.input ? undefined : () => finish(a.value)}
            >
              {a.label}
            </button>
          ))}
          <button type="button" className="secondary" onClick={() => finish(null)}>
            Annulla
          </button>
        </div>
      </form>
    </div>
  )
}
