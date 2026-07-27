import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { LANGUAGES } from '@shared/i18n'

/** "Language" dropdown. Custom rather than a native <select> so the open list matches
 *  the app's own panels. Names only — a language names itself better than a flag does,
 *  and flags stand for countries, not languages. */
export function LanguageSelect({ className = '' }: { className?: string }): JSX.Element {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const setLang = useStore((s) => s.setLang)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0]

  return (
    // `className` lets a caller hand it a share of a flex row — the trigger then
    // fills that share instead of hugging the language name
    <div className={`relative flex items-center gap-1.5 ${className}`} ref={ref}>
      <span className="shrink-0 text-xs text-slate-500">{t('ui.settings.language')}</span>
      <button
        className="flex flex-1 items-center justify-between gap-1.5 rounded-md border border-border2 bg-panel2 px-2.5 py-1.5 text-sm text-slate-200 transition hover:border-brand"
        onClick={() => setOpen((o) => !o)}
        title={t('ui.settings.language')}
      >
        <span>{current.label}</span>
        <span className="text-[10px] text-slate-500">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-md border border-border bg-panel shadow-glow">
          {LANGUAGES.map((l) => {
            const active = l.code === lang
            return (
              <button
                key={l.code}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition hover:bg-panel2 ${
                  active ? 'text-brand' : 'text-slate-200'
                }`}
                onClick={() => {
                  setLang(l.code)
                  setOpen(false)
                }}
              >
                <span className="flex-1">{l.label}</span>
                {active && <span className="text-brand">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
