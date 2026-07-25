import { useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'

/** Auto-popup update notification: when an update becomes available (store.update
 *  set by the updater — no user check needed), a toast appears bottom-right.
 *  Click it → details modal (what's fixed) → "Update now" starts the update.
 *  The actual download/install hooks to electron-updater later (window.recta). */
export function UpdateToast(): JSX.Element | null {
  const t = useT()
  const update = useStore((s) => s.update)
  const setUpdate = useStore((s) => s.setUpdate)
  const pushConsole = useStore((s) => s.pushConsole)
  const [open, setOpen] = useState(false)

  if (!update) return null

  const start = (): void => {
    // TODO: window.recta.startUpdate() — quit & install via electron-updater.
    pushConsole(t('ui.upd.started', { version: update.version }))
    setOpen(false)
    setUpdate(null)
  }

  return (
    <>
      {/* toast */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[55] flex items-center gap-3 rounded-lg border border-[#3390EC]/50 bg-panel px-4 py-3 text-left shadow-glow transition hover:border-[#3390EC]"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3390EC] text-base">⬆</span>
        <span>
          <span className="block text-sm font-semibold text-slate-100">{t('ui.upd.available')}</span>
          <span className="block font-mono text-[11px] text-[#3390EC]">RectaControl v{update.version}</span>
        </span>
      </button>

      {/* details modal */}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-8"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex w-full max-w-md flex-col rounded-lg border border-border bg-panel shadow-glow"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <span className="font-display text-sm font-bold tracking-wider text-[#3390EC]">
                ⬆ {t('ui.upd.title', { version: update.version })}
              </span>
              <button className="btn ml-auto text-xs" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto p-4">
              <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-slate-500">{t('ui.upd.whatsNew')}</div>
              <ul className="flex flex-col gap-1.5">
                {update.notes.map((n, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-200">
                    <span className="text-[#3390EC]">•</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                className="rounded-md border border-border2 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-400"
                onClick={() => setOpen(false)}
              >
                {t('ui.upd.later')}
              </button>
              <button
                className="rounded-md bg-[#3390EC] px-4 py-2 text-sm font-semibold text-[#020617] transition hover:opacity-90"
                onClick={start}
              >
                {t('ui.upd.now')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
