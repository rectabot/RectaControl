import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import type { BoardDrive, FirmwareVariant } from '@shared/types'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Flash RectaBot board firmware over the RP2350 UF2 bootloader. Body only —
 *  lives inside the Settings window's Firmware tab (no modal chrome).
 *  Connected board: `$UF2` reboots it into the bootloader automatically.
 *  Otherwise: enter BOOTSEL manually (hold BOOT, tap RUN) then Detect. */
export function FirmwareFlash(): JSX.Element {
  const t = useT()
  const connected = useStore((s) => s.connected)
  const jobRunning = useStore((s) => s.job.running)
  const askConfirm = useStore((s) => s.askConfirm)

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
    setMsg(t('ui.fw.sendingUf2'))
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
        setBoard(b)
        setBusy('idle')
        setMsg(null)
        return
      }
    }
    setBusy('idle')
    setMsg(t('ui.fw.noDrive'))
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

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* 1. choose image */}
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

      {/* 2. board / bootloader */}
      <div>
        <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-slate-500">
          {t('ui.fw.step2')}
        </div>
        {board ? (
          <div className="flex items-center gap-2 rounded border border-ok/40 bg-ok/10 px-3 py-2">
            <span className="text-ok">✓</span>
            <span className="font-mono text-sm text-slate-200">
              {board.model} <span className="text-slate-500">({board.drive})</span>
            </span>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              className="btn flex-1 text-xs"
              disabled={!connected || busy !== 'idle'}
              onClick={enterBootloader}
              title={connected ? t('ui.fw.enterTitleOn') : t('ui.fw.enterTitleOff')}
            >
              {busy === 'waiting' ? t('ui.fw.enterWait') : t('ui.fw.enter')}
            </button>
            <button
              className="btn flex-1 text-xs"
              disabled={busy !== 'idle'}
              onClick={detect}
              title={t('ui.fw.detectTitle')}
            >
              {busy === 'detecting' ? t('ui.fw.detecting') : t('ui.fw.detect')}
            </button>
          </div>
        )}
      </div>

      {/* 3. flash */}
      <button
        className="rounded-md bg-brand py-2.5 font-semibold text-[#020617] transition hover:bg-brandDark disabled:opacity-40"
        disabled={!uf2Path || !board || busy !== 'idle'}
        onClick={flash}
      >
        {busy === 'flashing' ? t('ui.fw.flashBtnBusy') : t('ui.fw.flashBtn')}
      </button>

      {msg && <div className="font-mono text-xs text-slate-400">{msg}</div>}

      <div className="font-mono text-[10px] leading-relaxed text-slate-500">{t('ui.fw.footer')}</div>
    </div>
  )
}
