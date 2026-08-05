import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useT, useLabel } from '../i18n'
import { PcIcon, SdIcon, FileIcon } from './icons'
import type { FmEntry } from '@shared/types'

const fmtSize = (n: number): string =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`

type Tab = 'pc' | 'sd'

/** Load / manage G-code. Two sources in one window:
 *   • PC  — a RectaControl-owned library folder on disk (no native dialogs;
 *           load/save/delete/import all in-app). Edits persist here.
 *   • SD  — the controller's card over the grblHAL `$F` control stream (works on
 *           USB and Ethernet); upload/download to PC use FTP (Ethernet only). */
export function FileManager(): JSX.Element | null {
  const t = useT()
  const L = useLabel()
  const open = useStore((s) => s.filesOpen)
  const setOpen = useStore((s) => s.setFilesOpen)
  const connected = useStore((s) => s.connected)
  const isEth = useStore((s) => s.connKind === 'ethernet')
  const setFile = useStore((s) => s.setFile)
  const setSdSource = useStore((s) => s.setSdSource)
  const setSuppressLog = useStore((s) => s.setSuppressLog)

  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('fm.tab') as Tab) || 'pc')
  const [host] = useState(() => localStorage.getItem('conn.ethHost') || '192.168.5.1')
  const [entries, setEntries] = useState<FmEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)

  const pickTab = (t: Tab): void => {
    localStorage.setItem('fm.tab', t)
    setErr(null)
    setEntries([])
    setTab(t)
  }

  // ---------------------------------------------------------------- PC library
  const libList = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      setEntries(await window.recta.libList())
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const libLoad = async (e: FmEntry): Promise<void> => {
    setLoading(e.name)
    try {
      const content = await window.recta.libRead(e.name)
      setFile(e.name, content, e.name) // libFile = name → edits save back to disk
      setOpen(false)
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setLoading(null)
    }
  }

  const libDelete = async (e: FmEntry): Promise<void> => {
    if (!window.confirm(t('ui.fm.confirmDelLib', { name: e.name }))) return
    try {
      await window.recta.libDelete(e.name)
      libList()
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }

  const libImport = async (): Promise<void> => {
    try {
      const added = await window.recta.libImport()
      if (added.length) libList()
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }

  // ------------------------------------------------------------------- SD card
  /** List SD files via `$F` (control stream — works on USB and Ethernet). */
  const sdList = (): void => {
    if (!connected) return
    setBusy(true)
    setErr(null)
    setSuppressLog(true)
    const collected: FmEntry[] = []
    let off: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout>
    const finish = (): void => {
      off?.()
      clearTimeout(timer)
      setSuppressLog(false)
      setEntries(collected.sort((a, b) => a.name.localeCompare(b.name)))
      setBusy(false)
    }
    off = window.recta.onEvent((ev) => {
      if (ev.type !== 'line') return
      const t = ev.data.trim()
      const m = /\[FILE:([^|\]]+)(?:\|(?:size:)?(\d+))?\]/i.exec(t)
      if (m) collected.push({ name: m[1], isDir: false, size: m[2] ? Number(m[2]) : 0 })
      else if (t === 'ok') finish()
    })
    timer = setTimeout(finish, 4000)
    window.recta.send('$F')
  }

  /** Send a command, wait for ok/error, then refresh the SD list. */
  const sdCmdThenList = (cmd: string): void => {
    setBusy(true)
    let off: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout>
    const done = (): void => {
      off?.()
      clearTimeout(timer)
      sdList()
    }
    off = window.recta.onEvent((ev) => {
      if (ev.type === 'line' && (ev.data.trim() === 'ok' || /^error/i.test(ev.data.trim()))) done()
    })
    timer = setTimeout(done, 3000)
    window.recta.send(cmd)
  }

  /** Load an SD file into the toolpath via `$F<=` (control stream, any connection). */
  const sdLoad = (e: FmEntry): void => {
    setLoading(e.name)
    setSuppressLog(true)
    const lines: string[] = []
    let off: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout>
    const finish = (): void => {
      off?.()
      clearTimeout(timer)
      setSuppressLog(false)
      setLoading(null)
      if (lines.length) {
        setFile(e.name, lines.join('\n'))
        setSdSource(e.name) // edits save back to the SD card (FTP, Ethernet)
        setOpen(false)
      } else setErr(t('ui.fm.emptyFile'))
    }
    off = window.recta.onEvent((ev) => {
      if (ev.type !== 'line') return
      const s = ev.data.trim()
      if (s === 'ok') return finish()
      if (s.startsWith('<') || s.startsWith('[') || /^error:/i.test(s) || s.startsWith('$F')) return
      lines.push(ev.data)
    })
    timer = setTimeout(finish, 20000)
    window.recta.send(`$F<=${e.name}`)
  }

  const sdDelete = (e: FmEntry): void => {
    if (!window.confirm(t('ui.fm.confirmDelSd', { name: e.name }))) return
    sdCmdThenList(`$FD=${e.name}`)
  }

  const sdFormat = (): void => {
    if (!window.confirm(t('ui.fm.formatConfirm1'))) return
    if (!window.confirm(t('ui.fm.formatConfirm2'))) return
    window.recta.send('$FF=yes')
    setErr(t('ui.fm.formatSent'))
  }

  const sdUpload = async (): Promise<void> => {
    localStorage.setItem('conn.ethHost', host)
    setBusy(true)
    setErr(null)
    try {
      await window.recta.fmUpload(host, '/')
      sdList()
    } catch (e) {
      setErr(t('ui.fm.uploadErr', { host, msg: (e as Error).message }))
      setBusy(false)
    }
  }
  const sdDownload = async (e: FmEntry): Promise<void> => {
    setErr(null)
    try {
      const name = await window.recta.fmDownloadToLib(host, e.name)
      setErr(t('ui.fm.downloadedTo', { name }))
    } catch (ex) {
      setErr(t('ui.fm.downloadErr', { host, msg: (ex as Error).message }))
    }
  }

  // refresh whenever the window opens or the tab changes
  useEffect(() => {
    if (!open) return
    if (tab === 'pc') libList()
    else sdList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab])

  if (!open) return null

  const isPc = tab === 'pc'
  const refresh = (): void => (isPc ? void libList() : sdList())
  const load = (e: FmEntry): void => void (isPc ? libLoad(e) : sdLoad(e))
  const del = (e: FmEntry): void => (isPc ? void libDelete(e) : sdDelete(e))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
      onClick={() => !busy && setOpen(false)}
    >
      <div
        className="flex max-h-full w-full max-w-2xl flex-col rounded-lg border border-border bg-panel shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header: source tabs */}
        <div className="flex items-center gap-1 border-b border-border px-3 py-2">
          <button
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              isPc ? 'bg-brand text-[#020617]' : 'text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => pickTab('pc')}
          >
            <PcIcon className={`h-4 w-4 ${isPc ? '' : 'text-brand'}`} /> PC
          </button>
          <button
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              !isPc ? 'bg-brand text-[#020617]' : 'text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => pickTab('sd')}
          >
            <SdIcon className={`h-4 w-4 ${!isPc ? '' : 'text-brand'}`} /> {L('ui.fm.sdCard')}
          </button>

          {!isPc && (
            <>
              <span
                className={`ml-2 h-2 w-2 rounded-full ${connected ? 'bg-ok shadow-glow' : 'bg-slate-600'}`}
                title={connected ? t('ui.fm.online') : t('ui.fm.notConnected')}
              />
              <span className="font-mono text-[10px] text-slate-500">
                {connected ? t('ui.fm.controlLink') : t('ui.fm.offline')}
              </span>
            </>
          )}

          <button className="btn ml-auto text-xs" onClick={refresh} disabled={busy} title={t('ui.top.refresh')}>
            ↻ {L('ui.top.refresh')}
          </button>
          <button className="btn text-xs" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>

        {/* list */}
        <div className="max-h-[26rem] min-h-[12rem] flex-1 overflow-y-auto p-1.5">
          {entries.length === 0 ? (
            <div className="p-10 text-center font-mono text-sm text-slate-500">
              {busy
                ? t('ui.fm.loading')
                : isPc
                  ? t('ui.fm.libEmpty')
                  : connected
                    ? t('ui.fm.sdEmpty')
                    : t('ui.fm.connectPrompt')}
            </div>
          ) : (
            entries.map((e) => {
              const isLoading = loading === e.name
              return (
                <div key={e.name} className="group flex items-center gap-2 rounded px-2.5 py-1.5 hover:bg-panel2">
                  <span className="flex w-5 justify-center text-brand">
                    <FileIcon className="h-4 w-4" />
                  </span>
                  <button
                    className="flex-1 truncate text-left font-mono text-sm text-slate-200"
                    onClick={() => load(e)}
                    title={t('ui.fm.loadTitle')}
                  >
                    {e.name}
                  </button>
                  {!isLoading && <span className="font-mono text-[10px] text-slate-500">{fmtSize(e.size)}</span>}
                  <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    <button
                      className="rounded bg-brand/90 px-2 py-0.5 text-[11px] font-semibold text-[#020617] hover:bg-brand disabled:opacity-40"
                      onClick={() => load(e)}
                      disabled={busy || loading !== null}
                      title={t('ui.fm.loadTitle')}
                    >
                      {isLoading ? '…' : L('ui.fm.load')}
                    </button>
                    {!isPc && (
                      <button
                        className="btn px-1.5 py-0.5 text-[11px] disabled:opacity-40"
                        onClick={() => sdDownload(e)}
                        disabled={busy || !isEth}
                        title={isEth ? t('ui.fm.saveToLib') : t('ui.fm.downloadNeedsEth')}
                      >
                        ⤓
                      </button>
                    )}
                    <button
                      className="rounded px-1.5 py-0.5 text-[11px] text-danger hover:bg-danger/15"
                      onClick={() => del(e)}
                      disabled={busy}
                      title={t('ui.fm.delete')}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* footer */}
        <div className="flex items-center gap-2 border-t border-border px-4 py-2">
          {isPc ? (
            <>
              <span className="flex-1 truncate font-mono text-[11px] text-slate-400">
                {err ?? t('ui.fm.libFooter')}
              </span>
              <button
                className="btn px-2.5 py-1 text-[11px]"
                onClick={() => window.recta.libReveal()}
                title={t('ui.fm.folderTitle')}
              >
                {L('ui.fm.folder')}
              </button>
              <button className="btn px-2.5 py-1 text-[11px]" onClick={libImport} title={t('ui.fm.importTitle')}>
                {L('ui.fm.import')}
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 truncate font-mono text-[11px] text-slate-400">
                {err ?? (isEth ? t('ui.fm.sdFooterEth') : t('ui.fm.sdFooterUsb'))}
              </span>
              <button
                className="btn px-2.5 py-1 text-[11px] disabled:opacity-40"
                onClick={sdUpload}
                disabled={!isEth || busy}
                title={isEth ? t('ui.fm.uploadTitle') : t('ui.fm.uploadNeedsEth')}
              >
                {L('ui.fm.upload')}
              </button>
              <button
                className="rounded px-2 py-0.5 text-[11px] text-danger hover:bg-danger/15 disabled:opacity-40"
                onClick={sdFormat}
                disabled={!connected}
                title={t('ui.fm.formatTitle')}
              >
                {L('ui.fm.format')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
