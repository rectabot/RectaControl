import { useEffect, useMemo, useState } from 'react'
import { useT } from '../i18n'
import { diffDumps } from '@shared/settings-file'
import type { BackupRow } from '@shared/types'

/** One line at the top of Settings: is this still the machine that was set up?
 *
 *  The folder behind it holds automatic dumps, and automatic dumps cannot answer that
 *  question — nothing written by a timer knows which of them was the good one. So a
 *  person marks one: "this is my machine, tuned correctly". Everything after that is
 *  arithmetic, and the arithmetic is the whole point. A machine drifts one setting at
 *  a time — a jog speed raised for one job, an acceleration nudged and forgotten, a
 *  spindle address that vanishes with a reboot — and each change is invisible on its
 *  own. Against a fixed point they are three named numbers on one line.
 *
 *  Deliberately not a diff viewer. The list of numbers is short by construction (a
 *  machine that differs from its baseline in forty settings is not drifting, it has
 *  been reconfigured), and every one of them is a link the operator already knows how
 *  to follow — the setting is on this very page.
 */
export function BaselineBanner({
  rows,
  connected
}: {
  rows: { num: number; value: string }[]
  connected: boolean
}): React.JSX.Element | null {
  const t = useT()
  const [base, setBase] = useState<{ row: BackupRow; text: string } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [naming, setNaming] = useState(false)
  const [label, setLabel] = useState('')
  /** bumped after a save, to re-read the folder */
  const [gen, setGen] = useState(0)

  useEffect(() => {
    let gone = false
    void (async () => {
      const list = await window.recta.settingsBackups()
      // newest first already; the baselines lead the list
      const row = list.find((r) => r.kind === 'baseline')
      const text = row ? await window.recta.readSettingsBackup(row.name) : null
      if (gone) return
      setBase(row && text ? { row, text } : null)
      setLoaded(true)
    })()
    return () => {
      gone = true
    }
  }, [gen])

  const current = useMemo(() => rows.map((r) => `$${r.num}=${r.value}`).join('\n') + '\n', [rows])
  const differs = useMemo(() => (base ? diffDumps(base.text, current) : []), [base, current])

  const save = async (): Promise<void> => {
    await window.recta.saveBaseline(current, label.trim())
    setLabel('')
    setNaming(false)
    setGen((n) => n + 1)
  }

  // Nothing to say until the board's settings are actually on screen: a comparison
  // against an empty read would announce that everything had changed.
  if (!loaded || !connected || rows.length === 0) return null

  const name = base ? base.row.label || new Date(base.row.taken).toLocaleDateString() : ''

  if (naming)
    return (
      <div className="flex items-center gap-2 border-b border-border bg-panel2/40 px-4 py-2 text-[12px]">
        <span className="shrink-0 text-slate-300">{t('ui.baseline.nameIt')}</span>
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') setNaming(false)
          }}
          placeholder={t('ui.baseline.namePlaceholder')}
          className="min-w-0 flex-1 rounded border border-border2 bg-transparent px-2 py-1 text-[12px] text-slate-100"
        />
        <button className="btn shrink-0 px-2 py-1 text-[11px]" onClick={() => void save()}>
          {t('ui.baseline.saveConfirm')}
        </button>
        <button className="btn shrink-0 px-2 py-1 text-[11px]" onClick={() => setNaming(false)}>
          {t('ui.baseline.cancel')}
        </button>
      </div>
    )

  return (
    <div className="flex items-center gap-2 border-b border-border bg-panel2/40 px-4 py-2 text-[12px]">
      {!base ? (
        <span className="min-w-0 flex-1 truncate text-slate-400">{t('ui.baseline.none')}</span>
      ) : differs.length === 0 ? (
        <span className="min-w-0 flex-1 truncate text-ok">✓ {t('ui.baseline.matches', { name })}</span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-warn">
          ⚠{' '}
          {t('ui.baseline.differs', {
            name,
            count: differs.length,
            // the numbers themselves, because "3 settings" sends somebody hunting and
            // "$20, $131, $476" sends them to three rows on this page
            list: differs.map((n) => `$${n}`).join(', ')
          })}
        </span>
      )}
      <button className="btn shrink-0 px-2 py-1 text-[11px]" onClick={() => setNaming(true)}>
        {base ? t('ui.baseline.replace') : t('ui.baseline.save')}
      </button>
    </div>
  )
}
