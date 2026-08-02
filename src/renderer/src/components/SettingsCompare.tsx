import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { diffDumps } from '@shared/settings-file'
import type { BackupRow } from '@shared/types'

/** One line at the top of Settings: is this still the machine that was set up?
 *
 *  The folder behind it holds automatic dumps, and automatic dumps cannot answer that
 *  question — nothing written by a timer knows which of them was the good one. The
 *  operator does, and says so by pressing Export, which they do when the machine is
 *  where they want it. Everything after that is arithmetic, and the arithmetic is the
 *  whole point: a machine drifts one setting at a time — a jog speed raised for one
 *  job, an acceleration nudged and forgotten, a spindle address that vanishes with a
 *  reboot — and each change is invisible on its own. Against a fixed point they are
 *  three named numbers on one line.
 *
 *  It carries no button of its own. It did, briefly, and Filip was right that a second
 *  control meaning "keep my settings" next to Export is one control and a puzzle. This
 *  states a fact and names the button that already acts on it.
 *
 *  Deliberately not a diff viewer. The list is short by construction — a machine that
 *  differs from its last export in forty settings has not drifted, it has been
 *  reconfigured — and every number in it is a row on this very page.
 */
export function SettingsCompare({
  rows,
  connected
}: {
  rows: { num: number; value: string }[]
  connected: boolean
}): React.JSX.Element | null {
  const t = useT()
  const [base, setBase] = useState<{ row: BackupRow; text: string } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const bulkWriting = useStore((s) => s.bulkWriting)

  // Re-read when the settings on screen change and when a bulk write ends: a fresh
  // export, or a restore that has just finished, both move the answer.
  useEffect(() => {
    let gone = false
    void (async () => {
      const list = await window.recta.settingsBackups()
      const row = list.find((r) => r.kind === 'export') // newest first
      const text = row ? await window.recta.readSettingsBackup(row.name) : null
      if (gone) return
      setBase(row && text ? { row, text } : null)
      setLoaded(true)
    })()
    return () => {
      gone = true
    }
  }, [rows, bulkWriting])

  const current = useMemo(() => rows.map((r) => `$${r.num}=${r.value}`).join('\n') + '\n', [rows])
  const differs = useMemo(() => (base ? diffDumps(base.text, current) : []), [base, current])

  // Nothing to say until the board's settings are actually on screen: a comparison
  // against an empty read would announce that everything had changed.
  if (!loaded || !connected || rows.length === 0) return null

  const name = base ? base.row.label || new Date(base.row.taken).toLocaleDateString() : ''

  return (
    <div className="border-b border-border bg-panel2/40 px-4 py-2 text-[12px]">
      {!base ? (
        <span className="text-slate-400">{t('ui.compare.none')}</span>
      ) : differs.length === 0 ? (
        <span className="text-ok">✓ {t('ui.compare.matches', { name })}</span>
      ) : (
        <span className="text-warn">
          ⚠{' '}
          {t('ui.compare.differs', {
            name,
            count: differs.length,
            // the numbers themselves, because "3 settings" sends somebody hunting and
            // "$20, $131, $476" sends them to three rows on this page
            list: differs.map((n) => `$${n}`).join(', ')
          })}
        </span>
      )}
    </div>
  )
}
