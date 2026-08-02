import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT, type TFunc } from '../i18n'
import type { BackupRow } from '@shared/types'

/** One saved dump, described the way somebody choosing between them needs it.
 *
 *  Shared with the guided recovery's picker deliberately: the two lists show the same
 *  files for the same purpose, and a row that reads differently depending on which
 *  door you came through is how the two drift apart. Exports lead with the operator's
 *  own words, the board's current state says so in words rather than a date nobody
 *  can place, and the rest are dates. Then what is IN the file — the setting count,
 *  and a ⚠ for a dump that names a Modbus VFD and carries no address for it — because
 *  the file about to be written onto a machine is not a thing to choose by hour.
 */
export function backupLabel(b: BackupRow, t: TFunc): string {
  const head =
    b.kind === 'export'
      ? `★ ${t('ui.rescue.backupExport')}${b.label ? ` · ${b.label}` : ''} · ${new Date(b.taken).toLocaleString()}`
      : b.kind === 'latest'
        ? `${t('ui.rescue.backupLatest')} · ${new Date(b.taken).toLocaleString()}`
        : new Date(b.taken).toLocaleString()
  const count = ` · ${t('ui.rescue.backupCount', { count: b.count })}`
  const short = b.vfdMissing === null ? '' : ` · ⚠ ${t('ui.rescue.backupNoVfd')}`
  return head + count + short
}

/** Choose a saved dump to write onto the board.
 *
 *  An in-app list rather than the OS file dialog, because the dialog was the wrong
 *  answer twice over: it opens on a folder of filenames that mean nothing on their
 *  own — `settings_2026-08-01_1321.txt` against fourteen siblings — and it will
 *  happily hand over the factory dumps the guided recovery hides on purpose. This
 *  shows what each file HOLDS and lists only what is safe to offer.
 *
 *  The escape hatch stays: a settings file mailed by somebody else, or kept on a USB
 *  stick, is a real thing to import, and that goes through the OS dialog with its own
 *  warnings still in front of it.
 */
export function BackupPicker({
  onPick,
  onCancel,
  onBrowse
}: {
  onPick: (name: string) => void
  onCancel: () => void
  onBrowse: () => void
}): React.JSX.Element {
  const t = useT()
  const [rows, setRows] = useState<BackupRow[] | null>(null)
  const [pick, setPick] = useState<string | null>(null)

  useEffect(() => {
    let gone = false
    void window.recta.settingsBackups().then((b) => {
      if (gone) return
      setRows(b)
      setPick(b[0]?.name ?? null)
    })
    return () => {
      gone = true
    }
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-border2 bg-panel shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-3 font-display text-sm font-bold tracking-wider text-slate-100">
          {t('ui.import.title')}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {rows === null ? (
            <p className="text-[13px] text-slate-500">{t('ui.import.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-warn">{t('ui.import.empty')}</p>
          ) : (
            rows.map((b) => (
              <button
                key={b.name}
                onClick={() => setPick(b.name)}
                onDoubleClick={() => onPick(b.name)}
                className={`block w-full rounded-md px-3 py-2 text-left font-mono text-[12px] transition ${
                  pick === b.name ? 'bg-brand/15 text-brand' : 'text-slate-300 hover:bg-panel2'
                }`}
              >
                {backupLabel(b, t)}
              </button>
            ))
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          <button className="btn px-3 py-1.5 text-[12px]" onClick={onBrowse}>
            {t('ui.import.browse')}
          </button>
          <div className="flex-1" />
          <button
            className="rounded-md border border-border2 px-4 py-1.5 text-sm font-semibold text-slate-200 transition hover:bg-border"
            onClick={onCancel}
          >
            {t('ui.confirm.cancel')}
          </button>
          <button
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-[#020617] transition hover:opacity-90 disabled:opacity-40"
            disabled={!pick}
            onClick={() => pick && onPick(pick)}
          >
            {t('ui.import.write')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
