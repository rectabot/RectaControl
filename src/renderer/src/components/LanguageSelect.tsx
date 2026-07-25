import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { LANGUAGES, type Lang } from '@shared/i18n'

/** Simplified US flag (7 red + 6 white stripes, blue canton). Drawn as inline SVG
 *  because emoji flags (🇺🇸) don't render on Windows — they show region letters. */
function FlagUS(): JSX.Element {
  const stripeH = 14 / 13
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" className="shrink-0 rounded-[2px]" aria-hidden>
      <rect width="20" height="14" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <rect key={i} y={i * stripeH} width="20" height={stripeH} fill="#b22234" />
      ))}
      <rect width="8.4" height={stripeH * 7} fill="#3c3b6e" />
    </svg>
  )
}

/** Simplified Serbian tricolor (red / blue / white). */
function FlagRS(): JSX.Element {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" className="shrink-0 rounded-[2px]" aria-hidden>
      <rect width="20" height="14" fill="#fff" />
      <rect width="20" height={14 / 3} fill="#c6363c" />
      <rect y={14 / 3} width="20" height={14 / 3} fill="#0c4076" />
    </svg>
  )
}

const FLAGS: Record<Lang, () => JSX.Element> = { en: FlagUS, sr: FlagRS }

/** "Language" dropdown with real flag graphics. Custom (not a native <select>) so
 *  the flags render on every OS and the open list can show flag + name per row. */
export function LanguageSelect(): JSX.Element {
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
  const CurrentFlag = FLAGS[current.code]

  return (
    <div className="relative flex items-center gap-1.5" ref={ref}>
      <span className="text-xs text-slate-500">{t('ui.settings.language')}</span>
      <button
        className="flex items-center gap-1.5 rounded-md border border-border2 bg-panel2 px-2 py-1 text-xs text-slate-200 transition hover:border-brand"
        onClick={() => setOpen((o) => !o)}
        title={t('ui.settings.language')}
      >
        <CurrentFlag />
        <span>{current.label}</span>
        <span className="text-[10px] text-slate-500">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-md border border-border bg-panel shadow-glow">
          {LANGUAGES.map((l) => {
            const Flag = FLAGS[l.code]
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
                <Flag />
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
