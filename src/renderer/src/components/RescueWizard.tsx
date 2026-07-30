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

/** One bar for the whole procedure, not one per step. A bar that stops and starts
 *  reads as "stuck" at exactly the moments the operator is least sure anything is
 *  happening — which is when they reach for the power switch. Each step owns a share
 *  of the whole and fills within it by something real: the erase is paced by the wait
 *  for the board to answer, the restore by settings actually written. The shares are
 *  estimates, but every boundary is a real event, so the bar can jump forward and
 *  never has to go back. */
const SPAN = { wipeEnd: 0.3, restoreEnd: 1 }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Wait for the board to answer a line command again, polling the probe. Returns
 *  false if it never does — which is a real answer, not a timeout to shrug at.
 *
 *  Reports how much of the wait has gone, because the alternative is a still screen
 *  during the twenty seconds where the operator is most likely to conclude it has
 *  hung and pull the power. It measures the wait it is actually doing — there is no
 *  bar over the erase itself, which is three bytes and a reboot and finishes before
 *  a bar could be drawn. */
async function waitForParser(
  onProgress: (frac: number) => void,
  totalMs = 20000
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < totalMs) {
    if (useStore.getState().connected && (await window.recta.rescueProbe(1500))) return true
    onProgress(Math.min(1, (Date.now() - start) / totalMs))
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
  // Opened by the detector, or by hand from Diagnostics? The subtitle asserted a
  // fault either way, so a healthy board opened out of curiosity was told it was
  // broken. It now says what was detected only when something was.
  const suggested = useStore((s) => s.rescueSuggested)
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
  /** 0..1 across the whole procedure, or null before it starts. Monotonic — see SPAN. */
  const [progress, setProgress] = useState<number | null>(null)
  const advance = (frac: number): void => setProgress((p) => (p === null ? frac : Math.max(p, frac)))
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)
  const [backups, setBackups] = useState<{ name: string; taken: string }[]>([])
  const [pick, setPick] = useState<string | null>(null)
  // The chosen backup's CONTENT, taken before anything is erased. Reading it later
  // is what went wrong on the first working run: the file was re-read after the
  // wipe, by which time a factory dump had overwritten it, and the recovery wrote
  // 250 steps/mm onto a tuned gantry and called it done. Whatever is restored has
  // to be what was on screen when the operator agreed to erase.
  const held = useRef<string | null>(null)
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

  // Hold the chosen file's content the moment it is chosen — see `held`.
  useEffect(() => {
    if (!open || !pick) {
      held.current = null
      return
    }
    void window.recta.readSettingsBackup(pick).then((txt) => {
      held.current = txt
    })
  }, [open, pick])

  if (!open) return null

  const set = (id: StepId, s: StepState): void => setState((prev) => ({ ...prev, [id]: s }))

  const run = async (): Promise<void> => {
    setRunning(true)
    setFinished(false)
    // Whatever the board dumps after this describes the firmware, not the machine.
    await window.recta.markSettingsFactory()

    try {
      // ---- 1. erase settings ------------------------------------------------
      // The app-wide reconnect is deliberately left ARMED here. The board reboots on
      // receipt and the link drops within the second — that drop is the event the
      // reconnect keys on, and it is the only thing that brings the board back for
      // the probe below to reach. Suppressing it "because the board is meant to go
      // away" broke this step on the first hardware run: the wipe worked, the board
      // came back, and the app sat there with no session, reported a failure, and
      // escalated to the bootloader for nothing.
      set('wipe', 'busy')
      setNote(t('ui.rescue.note.wiping'))
      await window.recta.rescueSend('wipe')
      await sleep(2500) // the board reboots on receipt; do not probe into the reset
      advance(0.02)
      if (await waitForParser((f) => advance(f * SPAN.wipeEnd))) {
        advance(SPAN.wipeEnd)
        set('wipe', 'ok')
        set('reflash', 'skipped')
        await restore()
        return
      }
      setProgress(null)
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
      // Now the suppression is right: the board is going to sit in the bootloader,
      // where there is nothing to connect to and a reconnect loop would only hunt.
      setNoReconnect(true)
      // Windows opens a folder window on the bootloader drive a moment after it
      // mounts, and it lands on top of this dialog — the operator is left reading
      // instructions that are no longer on screen. Same treatment as the flash flow:
      // hold the app in front, then minimise that window once the drive is up.
      // Minimised rather than closed, because while the drive is live it is also the
      // manual fallback — a .uf2 dragged onto it flashes the board without us.
      await window.recta.pinWindow(true)
      await window.recta.rescueSend('bootsel')
      for (let i = 0; i < 12; i++) {
        await sleep(700)
        const b = await window.recta.detectBoard()
        if (!b) continue
        await window.recta.dismissDriveWindow(b.drive, 'minimize')
        await sleep(1200) // Explorer opens it after the mount, not with it — sweep twice
        await window.recta.dismissDriveWindow(b.drive, 'minimize')
        break
      }
      await window.recta.pinWindow(false)
      setNote(t('ui.rescue.note.pickImage'))
      setFirmwareOpen(true)
      setFinished(true) // the operator continues in the firmware panel from here
    } catch (e) {
      setNote(t('ui.rescue.note.error', { msg: (e as Error).message }))
      setFinished(true)
    } finally {
      setProgress(null)
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
    const text = held.current
    if (!text) {
      set('restore', 'failed')
      setNote(t('ui.rescue.note.noBackup'))
      setFinished(true)
      return
    }
    advance(SPAN.wipeEnd)
    const { total, refused } = await applySettings(
      text,
      (f) => advance(SPAN.wipeEnd + f * (SPAN.restoreEnd - SPAN.wipeEnd)),
      {
        // A board that has just been wiped comes up before it knows it has a VFD, so
        // the settings that belong to one do not exist yet. One restart finishes the
        // job rather than handing the operator a list to type in by hand.
        rebootToFinish: true,
        onReboot: () => setNote(t('ui.rescue.note.rebooting'))
      }
    )
    setProgress(null)
    // The machine's own numbers are on the board again, so the dump that confirms
    // them is a real backup and must be filed as one.
    await window.recta.clearSettingsFactory()
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
    setProgress(null)
    setFinished(false)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center whitespace-normal bg-black/60 p-6">
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-2xl">
        <div className="shrink-0 border-b border-border px-6 py-3">
          <h2 className="text-sm font-semibold text-slate-100">{t('ui.rescue.title')}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-400">
            {t(suggested ? 'ui.rescue.subtitle' : 'ui.rescue.subtitleManual')}
          </p>
        </div>

        {/* Fixed height, not flex-1. Everything in here changes as the procedure runs —
            the backup picker goes away at Start, notes are one line or six, the bar
            appears — and a dialog that resizes under each of those moves the Close
            button out from under the pointer and makes the whole thing feel unsteady
            at the moment it is asking to be trusted. Sized for the longest message
            (the bootloader one); anything longer scrolls inside instead of growing. */}
        <div className="flex h-[260px] flex-col overflow-y-auto px-6 py-4">
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
                    {/* Filenames are ours, not the operator's. What they pick by is when
                        the settings were taken, so that is what the row says — with the
                        newest one named rather than dated twice. */}
                    {backups.map((b) => (
                      <option key={b.name} value={b.name} className="bg-panel">
                        {b.name === 'latest.txt' ? `${t('ui.rescue.backupLatest')} · ` : ''}
                        {new Date(b.taken).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="text-[12px] leading-relaxed text-warn">⚠ {t('ui.rescue.noBackupWarn')}</p>
              )}
            </div>
          )}

          {/* Everything that CHANGES sits here, above the bar. */}
          {note && <p className="mt-4 text-[13px] leading-relaxed text-slate-100">{note}</p>}

          {jobRunning && (
            <p className="mt-4 text-[12px] font-semibold text-danger">{t('ui.rescue.jobRunning')}</p>
          )}

          {/* Pinned to the bottom edge, not floated under the last line of text: a bar
              that moves with the length of the message above it is one more thing
              twitching on screen while the operator waits. */}
          {progress !== null && (
            <div className="mt-auto h-1.5 w-full shrink-0 overflow-hidden rounded-full bg-border2">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
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
