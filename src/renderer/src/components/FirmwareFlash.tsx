import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { RT } from '@shared/grbl'
import { fitVariant, readBoardLayout, type Fit } from '@shared/firmware-match'
import { useStore } from '../store'
import { useT, type TFunc } from '../i18n'
import { VariantDiagram } from './VariantDiagram'
import type { BoardDrive, FirmwareVariant, FlashProgress, TransportKind } from '@shared/types'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The badge's few words: long enough to say what changes, short enough to sit
 *  at the end of a row. null for images that agree with the board — silence is
 *  the right answer there, and marking all seven rows would mark none of them. */
function fitShort(fit: Fit, t: TFunc): string | null {
  if (fit.kind === 'same') return t('ui.fwFit.same')
  if (fit.kind !== 'differs') return null
  const parts: string[] = []
  if (fit.axes) parts.push(t('ui.fwFit.shortAxes', { from: fit.axes[0], to: fit.axes[1] }))
  if (fit.secondMotor === false) parts.push(t('ui.fwFit.shortLose'))
  if (fit.secondMotor === true) parts.push(t('ui.fwFit.shortGain'))
  return `⚠ ${parts.join(' · ')}`
}

/** Flash RectaBot board firmware over the RP2350 UF2 bootloader. Body only —
 *  lives inside the Settings window's Firmware tab (no modal chrome).
 *  Connected board: `$UF2` reboots it into the bootloader automatically.
 *  Otherwise: enter BOOTSEL manually (hold BOOT, tap RUN) then Detect. */
export function FirmwareFlash({ headerSlot }: { headerSlot?: HTMLElement | null }): JSX.Element {
  const t = useT()
  const connected = useStore((s) => s.connected)
  const jobRunning = useStore((s) => s.job.running)
  const askConfirm = useStore((s) => s.askConfirm)
  const setNoReconnect = useStore((s) => s.setNoReconnect)
  // a machine in Alarm refuses `$UF2` like every other `$` command (see below)
  const alarm = useStore((s) => (s.status?.state ?? '').split(':')[0] === 'Alarm')
  // what the board says it is running, once $I has come back
  const info = useStore((s) => s.info)
  // Survives the disconnect that $UF2 causes — the store only clears info when a
  // *new* connection opens — so the layout is still known at the moment of the
  // flash, which is exactly when it is needed.
  const layout = useMemo(() => readBoardLayout(info), [info])

  const [variants, setVariants] = useState<FirmwareVariant[]>([])
  const [selected, setSelected] = useState<string>('') // uf2Path
  const [customPath, setCustomPath] = useState<string | null>(null)
  const [board, setBoard] = useState<BoardDrive | null>(null)
  const [busy, setBusy] = useState<'idle' | 'detecting' | 'waiting' | 'flashing' | 'reconnecting'>('idle')
  const [msg, setMsg] = useState<string | null>(null)
  const [progress, setProgress] = useState<FlashProgress | null>(null)

  // Follow the copy as the main process makes it. Subscribed for the life of the
  // panel rather than around each flash: the board reboots the moment the last
  // block lands, and a listener torn down on the way out of `flash()` can miss the
  // tail of its own transfer.
  useEffect(() => window.recta.onFlashProgress(setProgress), [])

  // Never leave the app pinned above everything because this panel went away
  // mid-flow — Settings closed, window reloaded, a crash in the tree. A window
  // stuck in front of the whole desktop is a worse bug than the one we are hiding
  // from, and it is the kind that outlives the session that caused it.
  useEffect(() => () => void window.recta.pinWindow(false), [])

  useEffect(() => {
    // Nothing is selected until the operator selects it, and Flash stays dead until
    // then. The list used to arm itself with the first entry, which is `3axis` —
    // alphabetical order, and the single-Y image. On a dual-Y gantry that is the
    // one file in the folder that can bend the frame, and it sat pre-selected under
    // a live button. A default that costs nothing to make explicit should not have
    // one; picking the firmware is the whole decision this panel exists for.
    window.recta.listFirmware().then(setVariants)
    detect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const detect = async (): Promise<void> => {
    setBusy('detecting')
    const b = await window.recta.detectBoard()
    setBoard(b)
    setBusy('idle')
    setMsg(b ? null : t('ui.fw.notInBootloader'))
  }

  /** Send $UF2, then poll for the bootloader drive to appear. */
  const enterBootloader = async (): Promise<void> => {
    // $UF2 reboots the board into the bootloader — catastrophic mid-cut. Confirm.
    if (jobRunning) {
      const ok = await askConfirm({
        title: t('ui.fwGuard.title'),
        body: t('ui.fwGuard.body'),
        confirmLabel: t('ui.fwGuard.confirm')
      })
      if (!ok) return
    }

    // A machine in Alarm refuses `$` commands, $UF2 among them — so the board
    // never reboots, the drive never appears, and fourteen seconds later the app
    // used to shrug and say "no drive found". The operator is then left to hold
    // BOOT and tap RUN, wondering what broke. Offer the one thing that unblocks
    // it instead, and do it here rather than making them find the Reset button.
    if (alarm) {
      const ok = await askConfirm({
        title: t('ui.fwAlarm.title'),
        body: t('ui.fwAlarm.body'),
        confirmLabel: t('ui.fwAlarm.confirm'),
        tone: 'warn'
      })
      if (!ok) return
      window.recta.realtime(RT.softReset)
      await sleep(900) // let the reset land and the welcome banner pass
    }

    // From here until this component hands the link back, the board is meant to be
    // gone. Hold off the app-wide reconnect, which would otherwise start hunting for
    // a board that is sitting in the bootloader and race the loop below for the port.
    // Cleared again once we are talking to a board (see the 'connected' case in the
    // store), and in the bail-out paths here.
    setNoReconnect(true)

    setMsg(t('ui.fw.sendingUf2'))
    // Watch for the controller's answer: a refused $UF2 comes back as `error:n`
    // within milliseconds, and saying so beats a silent fourteen-second wait.
    let refused: string | null = null
    const off = window.recta.onEvent((e) => {
      if (e.type !== 'line') return
      const line = e.data.trim()
      if (/^error:/i.test(line)) {
        refused = line
        return
      }
      // The board announces the bootloader before it goes, and then it is gone —
      // but nothing closes the socket, so Ethernet carries on believing in it for
      // the best part of twenty seconds (19 s, measured 30 Jul 2026). For that
      // whole window the app shows a live connection to a machine that is not
      // there, and a jog sent into it disappears without a word. Take the board at
      // its word and drop the link now. Only on the announcement: a $UF2 that came
      // back as error:79 means the board is staying exactly where it is.
      if (/Entering UF2 Bootloader/i.test(line)) void window.recta.disconnect()
    })
    // From here until the drive is dealt with, the app stays in front: the folder
    // window Windows opens on the bootloader drive would otherwise land on top and
    // take the keyboard with it.
    await window.recta.pinWindow(true)
    try {
      await window.recta.send('$UF2')
    } catch {
      /* connection drops as the board reboots — expected */
    }
    setBusy('waiting')
    for (let i = 0; i < 20; i++) {
      await sleep(700)
      const b = await window.recta.detectBoard()
      if (b) {
        off()
        setBoard(b)
        setBusy('idle')
        setMsg(null)
        // Minimised, not closed: while the drive is live that window is the manual
        // fallback — a .uf2 dragged onto it flashes the board without us. It only
        // has to be out of the way, and it has to still be there.
        //
        // Explorer opens it a moment after the volume mounts, not with it, so one
        // sweep at detection time is a coin toss. Two, a second apart.
        await window.recta.dismissDriveWindow(b.drive, 'minimize')
        await sleep(1200)
        await window.recta.dismissDriveWindow(b.drive, 'minimize')
        await window.recta.pinWindow(false)
        return
      }
      // the board answered instead of rebooting — no point waiting out the loop
      if (refused) break
    }
    off()
    setBusy('idle')
    await window.recta.pinWindow(false)
    // No drive: either the board refused $UF2 and is still sitting there connected, or
    // it went somewhere we cannot see. Either way this flow is over, so re-arm the
    // reconnect by hand — the store only does it on a fresh 'connected', which never
    // arrives for a board that never left.
    setNoReconnect(false)
    // error:79 is the one refusal worth spelling out. It means a critical event is
    // latched, which a Reset does not clear while its cause is still there — so the
    // operator can press Reset all morning and get the same answer. Boards built
    // before 30 Jul 2026 refuse $UF2 in that state (the flag was missing from the
    // command); newer ones do not, but every board already in the field is an old one.
    setMsg(
      refused
        ? t(/^error:79\b/i.test(refused) ? 'ui.fw.refusedCritical' : 'ui.fw.refused', { err: refused })
        : t('ui.fw.noDrive')
    )
  }

  const pick = async (): Promise<void> => {
    const p = await window.recta.pickFirmware()
    if (p) {
      setCustomPath(p)
      setSelected(p)
    }
  }

  const uf2Path = selected || customPath || ''

  /** The shipped variant behind the current selection, if it is one of ours. A
   *  custom .uf2 picked off disk has no build.conf and so no drawing — we would
   *  be guessing at what it drives, which is the one thing not to guess at. */
  const selectedVariant = useMemo(() => variants.find((v) => v.uf2Path === selected) ?? null, [variants, selected])

  /** How each image relates to the board we last spoke to. Recomputed rather
   *  than stored: `variants` and `layout` are both cheap and both can change
   *  under us (a reconnect, a rebuilt image). */
  const fits = useMemo(() => {
    const m = new Map<string, Fit>()
    for (const v of variants) m.set(v.uf2Path, fitVariant(layout, v))
    return m
  }, [variants, layout])

  /** Spell out what the mismatch means, in the operator's terms rather than the
   *  build system's. Both halves are real consequences we have already paid for:
   *  the wipe took two hours to diagnose, the undriven motor nearly took a frame. */
  const mismatchBody = (fit: Fit): string => {
    const parts: string[] = []
    if (fit.axes) parts.push(t('ui.fwFit.bodyAxes', { from: fit.axes[0], to: fit.axes[1] }))
    if (fit.secondMotor === false) parts.push(t('ui.fwFit.bodyLose'))
    if (fit.secondMotor === true) parts.push(t('ui.fwFit.bodyGain'))
    parts.push(t('ui.fwFit.bodyWipe'))
    return parts.join(' ')
  }

  const flash = async (): Promise<void> => {
    if (!uf2Path || !board) return

    // The last gate before the copy. Everything up to here is reversible; this
    // is not — the moment the image lands, the settings are gone with it.
    const fit = fits.get(uf2Path)
    if (fit?.kind === 'differs') {
      const ok = await askConfirm({
        title: t('ui.fwFit.title'),
        body: mismatchBody(fit),
        confirmLabel: t('ui.fwFit.confirm'),
        cancelLabel: t('ui.fwFit.cancel'),
        tone: 'danger'
      })
      if (!ok) return
    }

    setBusy('flashing')
    setProgress(null)
    setMsg(t('ui.fw.flashing'))
    await window.recta.pinWindow(true)
    const drive = board.drive
    try {
      await window.recta.flashFirmware(uf2Path, drive)
      setBoard(null) // drive disappears after flashing
      // now it can go: the drive left with the reboot, so the window points at
      // nothing and the manual fallback it offered is no longer available anyway
      await window.recta.dismissDriveWindow(drive, 'close')
      await reconnect()
    } catch (e) {
      setMsg(t('ui.fw.error', { msg: (e as Error).message }))
      setBusy('idle')
    } finally {
      setProgress(null)
      await window.recta.pinWindow(false)
    }
  }

  /** Wait for the board to come back and pick the connection up again.
   *
   *  $UF2 drops the link on the way in, so after a flash the operator is left
   *  looking at a disconnected app and has to go and reconnect by hand — at the
   *  one moment they most want to see the board answer. Ethernet is tried alone
   *  for the first stretch, because it is slower to become ready than USB (the
   *  W5500 has to come up and start listening) and falling back the instant TCP
   *  refuses would hand back a USB link on a machine that was on the network a
   *  minute ago. After that, either will do. */
  const reconnect = async (): Promise<void> => {
    const ethHost = localStorage.getItem('conn.ethHost') || '192.168.5.1'
    const ethPort = Number(localStorage.getItem('conn.ethPort')) || 23
    const baud = Number(localStorage.getItem('conn.baud')) || 115200

    // Flashing a variant whose axis or motor count differs from the running one relays
    // grblHAL's settings and resets NVS to factory — so the dump this reconnect pulls
    // may describe the firmware rather than the machine, and must not become the file a
    // restore reaches for. Marked unconditionally: when NVS survived, the dump matches
    // what is already stored and skipping the write changes nothing, so there is no
    // reason to try to predict which flashes wipe.
    await window.recta.markSettingsFactory()

    setBusy('reconnecting')
    setMsg(t('ui.fw.reconnecting'))
    for (let i = 0; i < 14; i++) {
      await sleep(1500)
      if (useStore.getState().connected) break // something else got there first
      try {
        let kind: TransportKind | null
        if (i < 5) {
          await window.recta.connect({ kind: 'ethernet', host: ethHost, port: ethPort })
          kind = 'ethernet'
        } else {
          kind = await window.recta.autoConnect({ ethHost, ethPort, baud })
        }
        if (kind) {
          setBusy('idle')
          setMsg(t('ui.fw.reconnected', { kind: kind === 'ethernet' ? 'Ethernet' : 'USB' }))
          return
        }
      } catch {
        /* not up yet — the board is still booting, or this cable is not the one */
      }
    }
    setBusy('idle')
    // This loop is done either way. Hand the job back to the app-wide reconnect, which
    // keeps watching — a board that took longer than twenty seconds to come up is still
    // a board worth picking up when it does.
    setNoReconnect(false)
    setMsg(useStore.getState().connected ? t('ui.fw.flashed') : t('ui.fw.reconnectFail'))
  }

  const fileName = customPath ? customPath.split(/[\\/]/).pop() : null

  /** The doing half — bootloader, detect, flash. Rendered into the Settings header
   *  when a slot is offered (the search field is dead on this tab, so the row would
   *  otherwise sit empty), else kept inline so the component still works alone.
   *  Once the board is found the first two buttons have done their job and give way
   *  to the ✓ status, which is why this is one row and not three fixed slots. */
  const actions = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {board ? (
        <span className="flex min-w-0 shrink items-center gap-1.5 truncate rounded-md border border-ok/40 bg-ok/10 px-2.5 py-1.5 font-mono text-xs text-slate-200">
          <span className="text-ok">✓</span>
          {board.model} <span className="text-slate-500">({board.drive})</span>
        </span>
      ) : (
        <>
          <button
            className="btn shrink-0 py-1.5 text-sm"
            disabled={!connected || busy !== 'idle'}
            onClick={enterBootloader}
            title={connected ? t('ui.fw.enterTitleOn') : t('ui.fw.enterTitleOff')}
          >
            {busy === 'waiting' ? t('ui.fw.enterWait') : t('ui.fw.enter')}
          </button>
          <button
            className="btn shrink-0 py-1.5 text-sm"
            disabled={busy !== 'idle'}
            onClick={detect}
            title={t('ui.fw.detectTitle')}
          >
            {busy === 'detecting' ? t('ui.fw.detecting') : t('ui.fw.detect')}
          </button>
        </>
      )}
      <button
        className="ml-auto shrink-0 rounded-md bg-brand px-5 py-1.5 text-sm font-semibold text-[#020617] transition hover:bg-brandDark disabled:opacity-40"
        disabled={!uf2Path || !board || busy !== 'idle'}
        onClick={flash}
      >
        {busy === 'flashing' ? t('ui.fw.flashBtnBusy') : t('ui.fw.flashBtn')}
      </button>
    </div>
  )

  return (
    <>
      {headerSlot ? createPortal(actions, headerSlot) : null}
      {/* min-h-full so the drawing at the bottom has a height to fill: the pane
          around this scrolls, and inside a scroller flex-1 has nothing to divide
          unless the column is told to be at least as tall as the view. */}
      <div className="flex min-h-full flex-col gap-4 p-4">
        {!headerSlot && actions}

        {/* What the board is running was printed here as well as marked in the list
            — the same fact in two places, and the eye has to check both to be sure
            they agree. The list is where the decision is made, so the mark stays
            there and the banner goes. */}

        {/* choose image */}
        <div>
          <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-slate-500">{t('ui.fw.step1')}</div>
          <div className="flex flex-col gap-1">
            {variants.map((v) => {
              // Marked only where it carries information: the one already on the
              // board, and the ones that would change the motor layout. A badge
              // on every row is a badge nobody reads.
              const fit = fits.get(v.uf2Path)
              const short = fit ? fitShort(fit, t) : null
              return (
                <label key={v.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-panel2">
                  <input
                    type="radio"
                    name="fw"
                    className="accent-brand"
                    checked={selected === v.uf2Path}
                    onChange={() => {
                      setSelected(v.uf2Path)
                      setCustomPath(null)
                    }}
                  />
                  <span className="flex-1 truncate font-mono text-sm text-slate-200">{v.label}</span>
                  {short && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                        fit?.kind === 'same' ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'
                      }`}
                      title={fit?.kind === 'differs' ? mismatchBody(fit) : undefined}
                    >
                      {short}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-slate-500">{v.sizeKB} KB</span>
                </label>
              )
            })}
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-panel2">
              <input
                type="radio"
                name="fw"
                className="accent-brand"
                checked={!!customPath && selected === customPath}
                onChange={pick}
              />
              <span className="flex-1 truncate font-mono text-sm text-slate-300">
                {fileName ? t('ui.fw.custom', { name: fileName }) : t('ui.fw.pickFile')}
              </span>
              {fileName && (
                <span className="shrink-0 rounded bg-slate-500/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                  {t('ui.fwFit.unchecked')}
                </span>
              )}
            </label>
          </div>

          {/* Without a $I from the board there is nothing to compare against, and
              an unmarked list would read as "all of these are fine". Say why the
              marks are missing instead of leaving it to be inferred. */}
          {layout.variant == null && layout.axes == null && (
            <div className="mt-2 font-mono text-[10px] leading-relaxed text-slate-500">{t('ui.fwFit.noBoard')}</div>
          )}

        </div>

        {/* Every word this panel says, in one block of fixed height directly under
            the list. Fixed because the drawing below takes what is left: a message
            that appears mid-flash would otherwise resize the drawing under the
            operator's eyes, and a diagram that jumps while you are reading it is a
            diagram you stop trusting. The empty space when there is nothing to say
            is the price, and it is worth paying. */}
        <div className="flex h-[112px] shrink-0 flex-col gap-2">
          {/* The copy takes about eight seconds — the bootloader writes each block
              into flash as it arrives — and eight seconds of a frozen-looking panel
              during the one operation nobody dares interrupt is too long to leave
              unexplained. The bar counts bytes the drive has actually taken. */}
          <div className="h-[26px] shrink-0">
            {progress && (
              <div className="flex flex-col gap-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
                  <div
                    className="h-full rounded-full bg-brand transition-[width] duration-150 ease-out"
                    style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                  />
                </div>
                <div className="flex justify-between font-mono text-[10px] text-slate-500">
                  <span>{t(progress.phase === 'verify' ? 'ui.fw.phaseVerify' : 'ui.fw.phaseWrite')}</span>
                  <span>
                    {Math.round(progress.done / 1024)} / {Math.round(progress.total / 1024)} KB
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="h-[20px] shrink-0 overflow-hidden font-mono text-xs text-slate-400">{msg}</div>

          <div className="min-h-0 flex-1 overflow-hidden font-mono text-[10px] leading-relaxed text-slate-500">
            {t('ui.fw.footer')}
          </div>
        </div>

        {/* The picture of whatever is selected, given the whole of what is left —
            and nothing below it, so it is the last thing on the screen and the eye
            has nowhere else to go. Nothing selected, nothing drawn: a default
            drawing would imply a default choice, and there isn't one any more. */}
        {selectedVariant && (
          <div className="min-h-[200px] flex-1">
            <VariantDiagram config={selectedVariant.config} />
          </div>
        )}
      </div>
    </>
  )
}
