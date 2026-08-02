import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useT } from '../i18n'

/** The one shared confirmation modal, driven by store `confirm` / `askConfirm`.
 *  Mounted once (App). Every guarded action (disconnect / quit / flash mid-job …)
 *  calls `askConfirm(...)` and awaits the user's choice — no per-call-site modal.
 *
 *  It also asks for a line of text (`askText`), which is the same dialog with a field
 *  in it. Worth resisting a second modal for: naming an export is a question, and a
 *  question deserves the same frame, the same keys and the same place on screen as
 *  every other one — the only difference being that this one is not a warning, and is
 *  not dressed as one. */
export function ConfirmDialog(): JSX.Element | null {
  const t = useT()
  const confirm = useStore((s) => s.confirm)
  const resolve = useStore((s) => s.resolveConfirm)
  const [text, setText] = useState('')
  const field = useRef<HTMLInputElement>(null)

  // a fresh dialog starts empty and holding the caret, however the last one ended
  const open = confirm != null
  useEffect(() => {
    if (!open) return
    setText('')
    field.current?.focus()
  }, [open])

  if (!confirm) return null

  const tone = confirm.tone ?? 'danger'
  const border = tone === 'ask' ? 'border-border2' : tone === 'warn' ? 'border-warn/50' : 'border-danger/50'
  const heading = tone === 'ask' ? 'text-slate-100' : tone === 'warn' ? 'text-warn' : 'text-danger'
  const confirmBtn =
    tone === 'ask'
      ? 'bg-brand text-[#020617] hover:opacity-90'
      : tone === 'warn'
        ? 'bg-warn text-[#020617] hover:opacity-90'
        : 'bg-danger text-white hover:opacity-90'

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={() => resolve(false)}
    >
      <div
        className={`w-full max-w-md rounded-lg border ${border} bg-panel shadow-glow`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex items-center gap-2 border-b border-border px-5 py-3 font-display text-sm font-bold tracking-wider ${heading}`}
        >
          {tone === 'ask' ? '' : '⚠ '}
          {confirm.title}
        </div>
        <div className="px-5 py-4 text-[13px] leading-relaxed text-slate-300">{confirm.body}</div>
        {confirm.prompt && (
          <div className="px-5 pb-4">
            <input
              ref={field}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter confirms — including on an empty field, where empty is the
                // answer "no name, use the date"
                if (e.key === 'Enter') resolve(true, text)
                if (e.key === 'Escape') resolve(false)
              }}
              placeholder={confirm.prompt.placeholder}
              className="w-full rounded border border-border2 bg-transparent px-2 py-1.5 text-[13px] text-slate-100 placeholder:text-slate-600"
            />
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            className="rounded-md border border-border2 px-4 py-1.5 text-sm font-semibold text-slate-200 transition hover:bg-border"
            onClick={() => resolve(false)}
          >
            {confirm.cancelLabel ?? t('ui.confirm.cancel')}
          </button>
          <button
            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${confirmBtn}`}
            onClick={() => resolve(true, text)}
          >
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
