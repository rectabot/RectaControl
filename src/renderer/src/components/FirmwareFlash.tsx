import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { RT } from '@shared/grbl'
import { useStore } from '../store'
import { useT } from '../i18n'
import type { BoardDrive, FirmwareVariant } from '@shared/types'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Flash RectaBot board firmware over the RP2350 UF2 bootloader. Body only —
 *  lives inside the Settings window's Firmware tab (no modal chrome).
 *  Connected board: `$UF2` reboots it into the bootloader automatically.
 *  Otherwise: enter BOOTSEL manually (hold BOOT, tap RUN) then Detect. */
export function FirmwareFlash({ headerSlot }: { headerSlot?: HTMLElement | null }): JSX.Element {
  const t = useT()
  const connected = useStore((s) => s.connected)
  const jobRunning = useStore((s) => s.job.running)
  const askConfirm = useStore((s) => s.askConfirm)
  // a machine in Alarm refuses `$UF2` like every other `$` command (see below)
  const alarm = useStore((s) => (s.status?.state ?? '').split(':')[0] === 'Alarm')
  // what the board says it is running, once $I has come back
  const firmwareBuild = useStore((s) => s.info.firmwareBuild)

  const [variants, setVariants] = useState<FirmwareVariant[]>([])
  const [selected, setSelected] = useState<string>('') // uf2Path
  const [customPath, setCustomPath] = useState<string | null>(null)
  const [board, setBoard] = useState<BoardDrive | null>(null)
  const [busy, setBusy] = useState<'idle' | 'detecting' | 'waiting' | 'flashing'>('idle')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    window.recta.listFirmware().then((v) => {
      setVariants(v)
      if (v.length && !selected && !customPath) setSelected(v[0].uf2Path)
    })
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

    setMsg(t('ui.fw.sendingUf2'))
    // Watch for the controller's answer: a refused $UF2 comes back as `error:n`
    // within milliseconds, and saying so beats a silent fourteen-second wait.
    let refused: string | null = null
    const off = window.recta.onEvent((e) => {
      if (e.type === 'line' && /^error:/i.test(e.data.trim())) refused = e.data.trim()
    })
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
        return
      }
      // the board answered instead of rebooting — no point waiting out the loop
      if (refused) break
    }
    off()
    setBusy('idle')
    setMsg(refused ? t('ui.fw.refused', { err: refused }) : t('ui.fw.noDrive'))
  }

  const pick = async (): Promise<void> => {
    const p = await window.recta.pickFirmware()
    if (p) {
      setCustomPath(p)
      setSelected(p)
    }
  }

  const uf2Path = selected || customPath || ''

  const flash = async (): Promise<void> => {
    if (!uf2Path || !board) return
    setBusy('flashing')
    setMsg(t('ui.fw.flashing'))
    try {
      await window.recta.flashFirmware(uf2Path, board.drive)
      setMsg(t('ui.fw.flashed'))
      setBoard(null) // drive disappears after flashing
    } catch (e) {
      setMsg(t('ui.fw.error', { msg: (e as Error).message }))
    } finally {
      setBusy('idle')
    }
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
      <div className="flex flex-col gap-4 p-4">
        {!headerSlot && actions}

        {/* What is on the board right now. Until the firmware started stamping
            itself into $I there was no way to answer that except by watching how
            the machine behaved — and "did my flash take?" is the first question
            after every flash. Blank when disconnected, honest when the board is
            running something that is not ours. */}
        {connected && (
          <div className="flex items-baseline gap-2 rounded-md border border-border bg-panel2 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{t('ui.fw.onBoard')}</span>
            <span className={`font-mono text-xs ${firmwareBuild ? 'text-ok' : 'text-slate-500'}`}>
              {firmwareBuild ?? t('ui.fw.onBoardUnknown')}
            </span>
          </div>
        )}

        {/* choose image */}
        <div>
          <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-slate-500">{t('ui.fw.step1')}</div>
          <div className="flex flex-col gap-1">
            {variants.map((v) => (
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
                <span className="font-mono text-[10px] text-slate-500">{v.sizeKB} KB</span>
              </label>
            ))}
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
            </label>
          </div>
        </div>

        {msg && <div className="font-mono text-xs text-slate-400">{msg}</div>}

        <div className="font-mono text-[10px] leading-relaxed text-slate-500">{t('ui.fw.footer')}</div>
      </div>
    </>
  )
}
