import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useT } from '../i18n'
import { applySettings } from '../applySettings'

/** Guided recovery for a board that has stopped answering commands.
 *
 *  The failure this exists for does not look like a dead board. It boots, it greets,
 *  it keeps replying to `?` — and it ignores `$I`, `$$`, `$X` and even a bare
 *  newline, because grblHAL suspends the line parser in some states and realtime
 *  bytes are handled in the receive interrupt regardless. On 29 Jul 2026 that cost
 *  most of a day and was misread as a corrupted settings image; it was factory
 *  defaults that did not describe this board.
 *
 *  Three steps, cheapest first, each one verified before the next is offered. If the
 *  first works the rest are crossed out in front of the operator rather than hidden:
 *  seeing that there was a deeper level, and that you did not need it, is worth the
 *  two lines it costs.
 */

type StepId = 'wipe' | 'reflash' | 'restore'
type StepState = 'todo' | 'busy' | 'ok' | 'skipped' | 'failed'

const ORDER: StepId[] = ['wipe', 'reflash', 'restore']

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Wait for the board to answer a line command again, polling the probe. Returns
 *  false if it never does — which is a real answer, not a timeout to shrug at. */
async function waitForParser(totalMs = 20000): Promise<boolean> {
  const until = Date.now() + totalMs
  while (Date.now() < until) {
    if (useStore.getState().connected && (await window.recta.rescueProbe(1500))) return true
    await sleep(700)
  }
  return false
}

function Mark({ state }: { state: StepState }): React.JSX.Element {
  if (state === 'ok') return <span className="text-ok">✓</span>
  if (state === 'failed') return <span className="text-danger">✗</span>
  if (state === 'skipped') return <span className="text-slate-600">—</span>
  if (state === 'busy') return <span className="animate-pulse text-brand">●</span>
  return <span className="text-border2">○</span>
}

export function RescueWizard(): React.JSX.Element | null {
  const t = useT()
  const open = useStore((s) => s.rescueWizardOpen)
  const setOpen = useStore((s) => s.setRescueWizardOpen)
  const setNoReconnect = useStore((s) => s.setNoReconnect)
  const setFirmwareOpen = useStore((s) => s.setFirmwareOpen)
  const connected = useStore((s) => s.connected)
  const connKind = useStore((s) => s.connKind)
  const jobRunning = useStore((s) => s.job.running)

  const [state, setState] = useState<Record<StepId, StepState>>({
    wipe: 'todo',
    reflash: 'todo',
    restore: 'todo'
  })
  const [note, setNote] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)
  const [backups, setBackups] = useState<{ name: string; taken: string }[]>([])
  const [pick, setPick] = useState<string | null>(null)
  const cancelled = useRef(false)

  // The backup list is the honest part of the warning: the operator is about to lose
  // the machine's numbers, and "they are safe somewhere" is worth nothing next to a
  // file name and the date it was taken. An empty list changes what this dialog says.
  useEffect(() => {
    if (!open) return
    cancelled.current = false
    void window.recta.settingsBackups().then((b) => {
      setBackups(b)
      setPick(b[0]?.name ?? null)
    })
    return () => {
      cancelled.current = true
    }
  }, [open])

  if (!open) return null

  const set = (id: StepId, s: StepState): void => setState((prev) => ({ ...prev, [id]: s }))

  const run = async (): Promise<void> => {
    setRunning(true)
    setFinished(false)
    // The board is about to go away on purpose, twice. Hold off the app-wide
    // reconnect so it does not race us for the port, and tell the backup that what
    // comes back may be factory values rather than this machine.
    setNoReconnect(true)
    await window.recta.markSettingsFactory()

    try {
      // ---- 1. erase settings ------------------------------------------------
      set('wipe', 'busy')
      setNote(t('ui.rescue.note.wiping'))
      await window.recta.rescueSend('wipe')
      await sleep(2500) // the board reboots on receipt; do not probe into the reset
      setNoReconnect(false) // let the reconnect pick it up as it comes back
      if (await waitForParser()) {
        set('wipe', 'ok')
        set('reflash', 'skipped')
        await restore()
        return
      }
      set('wipe', 'failed')
      if (cancelled.current) return

      // ---- 2. reflash -------------------------------------------------------
      // Deliberately not automated. Which image goes on a board is the one decision
      // in this whole procedure that must stay with a person: on 29 Jul 2026 a
      // single-Y image on a dual-Y gantry homed "successfully" on one motor and bent
      // the frame. The firmware panel draws what each image drives — that drawing is
      // the safeguard, and it only works if somebody looks at it.
      if (connKind !== 'usb' && !(await hasUsb())) {
        set('reflash', 'failed')
        setNote(t('ui.rescue.note.needUsb'))
        setFinished(true)
        return
      }
      set('reflash', 'busy')
      setNote(t('ui.rescue.note.bootloader'))
      setNoReconnect(true)
      await window.recta.rescueSend('bootsel')
      await sleep(2500)
      setNote(t('ui.rescue.note.pickImage'))
      setFirmwareOpen(true)
      setFinished(true) // the operator continues in the firmware panel from here
    } catch (e) {
      setNote(t('ui.rescue.note.error', { msg: (e as Error).message }))
      setFinished(true)
    } finally {
      setRunning(false)
      setNoReconnect(false)
    }
  }

  // ---- 3. put the machine's own numbers back ------------------------------
  const restore = async (): Promise<void> => {
    if (!pick) {
      set('restore', 'failed')
      setNote(t('ui.rescue.note.noBackup'))
      setFinished(true)
      return
    }
    set('restore', 'busy')
    setNote(t('ui.rescue.note.restoring'))
    const text = await window.recta.readSettingsBackup(pick)
    if (!text) {
      set('restore', 'failed')
      setNote(t('ui.rescue.note.noBackup'))
      setFinished(true)
      return
    }
    const { total, refused } = await applySettings(text)
    set('restore', refused.length ? 'failed' : 'ok')
    setNote(
      refused.length
        ? t('ui.rescue.note.restoredPartly', { count: refused.length, list: refused.join(', ') })
        : t('ui.rescue.note.restored', { count: total })
    )
    setFinished(true)
  }

  const label: Record<StepId, string> = {
    wipe: t('ui.rescue.step.wipe'),
    reflash: t('ui.rescue.step.reflash'),
    restore: t('ui.rescue.step.restore')
  }

  const close = (): void => {
    setOpen(false)
    setState({ wipe: 'todo', reflash: 'todo', restore: 'todo' })
    setNote(null)
    setFinished(false)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center whitespace-normal bg-black/60 p-6">
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-2xl">
        <div className="shrink-0 border-b border-border px-6 py-3">
          <h2 className="text-sm font-semibold text-slate-100">{t('ui.rescue.title')}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{t('ui.rescue.subtitle')}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ol className="space-y-2">
            {ORDER.map((id) => (
              <li key={id} className="flex gap-3 text-[13px]">
                <Mark state={state[id]} />
                <span className={state[id] === 'skipped' ? 'text-slate-600 line-through' : 'text-slate-200'}>
                  {label[id]}
                </span>
              </li>
            ))}
          </ol>

          {/* What the numbers come back from — shown before anything is erased, not after. */}
          {!running && !finished && (
            <div className="mt-4 rounded-lg border border-border2 p-3">
              {backups.length ? (
                <>
                  <label className="block text-[11px] uppercase tracking-wide text-slate-500">
                    {t('ui.rescue.restoreFrom')}
                  </label>
                  <select
                    className="mt-1 w-full rounded border border-border2 bg-transparent px-2 py-1.5 text-[13px] text-slate-100"
                    value={pick ?? ''}
                    onChange={(e) => setPick(e.target.value)}
                  >
                    {backups.map((b) => (
                      <option key={b.name} value={b.name} className="bg-panel">
                        {b.name} — {new Date(b.taken).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="text-[12px] leading-relaxed text-warn">⚠ {t('ui.rescue.noBackupWarn')}</p>
              )}
            </div>
          )}

          {note && <p className="mt-4 text-[13px] leading-relaxed text-slate-100">{note}</p>}

          {jobRunning && (
            <p className="mt-4 text-[12px] font-semibold text-danger">{t('ui.rescue.jobRunning')}</p>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-border px-6 py-3">
          {!finished && (
            <button
              className="flex-1 rounded-lg border-2 border-warn px-4 py-2.5 text-sm font-semibold text-warn transition disabled:opacity-30 enabled:hover:bg-warn enabled:hover:text-[#020617]"
              disabled={running || jobRunning || !connected}
              onClick={run}
            >
              {t('ui.rescue.start')}
            </button>
          )}
          <button
            className="flex-1 rounded-lg border-2 border-border2 px-4 py-2.5 text-sm font-semibold text-slate-200 transition disabled:opacity-30 enabled:hover:border-brand enabled:hover:text-brand"
            disabled={running}
            onClick={close}
          >
            {t(finished ? 'ui.rescue.close' : 'ui.rescue.cancel')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Is there a serial port at all to reach the bootloader on? The bootloader is USB
 *  mass storage and has no network, so an Ethernet-only setup cannot be flashed —
 *  and the procedure has to say that rather than offer a step it cannot finish. */
async function hasUsb(): Promise<boolean> {
  try {
    return (await window.recta.listPorts()).length > 0
  } catch {
    return false
  }
}
