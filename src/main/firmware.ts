/** Firmware flashing helpers (RP2350 UF2 bootloader).
 *
 *  Flow: the board enters the bootloader via the grblHAL `$UF2` command (or a
 *  manual BOOT+RUN), mounts as a FAT drive containing INFO_UF2.TXT, and we flash
 *  by copying a .uf2 file onto it. The board reboots into the new firmware. */

import { app, dialog } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { access, open, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { log } from './logger'
import type { BoardDrive, FirmwareVariant, FlashProgress, VariantConfig } from '@shared/types'

const execFileAsync = promisify(execFile)

/** Folder holding prebuilt variant .uf2 files (one subfolder per variant).
 *
 *  The images ship INSIDE the app (electron-builder extraResources → resources/
 *  Firmware/variants), which is why they are found without a network: the moment
 *  you most need to flash is the moment the machine is not working, and a shop PC
 *  is often not online. Six megabytes for seven builds is a cheap way to never
 *  have to say "download it first".
 *
 *  In dev there is no resources folder, so the repo's own Firmware/variants is
 *  used — freshly built images show up without packaging anything. Either can be
 *  overridden with RECTA_FIRMWARE_DIR. */
function variantsDir(): string {
  if (process.env.RECTA_FIRMWARE_DIR) return process.env.RECTA_FIRMWARE_DIR
  if (app.isPackaged) return join(process.resourcesPath, 'Firmware', 'variants')
  // In dev app.getAppPath() == <repo>/rectacontrol
  return join(app.getAppPath(), '..', 'Firmware', 'variants')
}

function prettyLabel(folder: string, file: string): string {
  // Friendly names for the shipped kinematics variants (folder → label), matching
  // the web configurator. Unknown folders fall back to the raw folder name.
  //
  // The single-motor variants say so out loud. Reading "4-axis (X/Y/Z + rotary A)"
  // on a machine that is four-axis with a rotary A is a perfectly reasonable way
  // to pick the wrong image — the label was silent about the one thing that
  // mattered, and on 29 Jul 2026 that cost a gantry.
  const map: Record<string, string> = {
    '3axis': '3-axis (X/Y/Z) — single Y motor',
    '3axis-ganged-y': '3-axis + dual-Y gantry (ganged)',
    '3axis-autosquare-y': '3-axis + dual-Y gantry (auto-square)',
    '4axis-rotary-a': '4-axis (X/Y/Z + rotary A) — single Y motor',
    '4axis-a-ganged-y': '4-axis + dual-Y gantry (ganged), rotary A',
    '4axis-a-autosquare-y': '4-axis + dual-Y gantry (auto-square), rotary A',
    '5axis': '5-axis (X/Y/Z/A/B) — single Y motor'
  }
  const name = map[folder] ?? folder
  // Show the version from the .uf2 name (…_v1.0.uf2) instead of the whole filename.
  const ver = /_v([\d.]+)\.uf2$/i.exec(file)
  return ver ? `${name} (v${ver[1]})` : `${name} — ${file}`
}

/** Read a variant's build.conf — the same file the build script compiles from, so
 *  the app's idea of what an image contains cannot drift from what is in it.
 *
 *      N_AXIS=4
 *      DEFINES=Y_GANGED=1
 *
 *  Returns null when the file is missing or has no N_AXIS: a variant we cannot
 *  describe must not be described, because the pre-flash check reads silence as
 *  "unknown" and a wrong guess there is worse than no guess. */
function readConfig(dir: string): VariantConfig | null {
  let txt: string
  try {
    txt = readFileSync(join(dir, 'build.conf'), 'utf8')
  } catch {
    return null
  }
  const axes = Number(/^\s*N_AXIS\s*=\s*(\d+)/m.exec(txt)?.[1])
  if (!Number.isFinite(axes) || axes <= 0) return null

  const defines = /^\s*DEFINES\s*=\s*(.*)$/m.exec(txt)?.[1] ?? ''
  const secondMotor: string[] = []
  let autoSquare = false
  for (const m of defines.matchAll(/\b([XYZ])_(GANGED|AUTO_SQUARE)\s*=\s*1\b/g)) {
    secondMotor.push(m[1])
    if (m[2] === 'AUTO_SQUARE') autoSquare = true
  }
  return { axes, secondMotor, autoSquare }
}

/** Enumerate prebuilt .uf2 images under the variants folder. */
export function listVariants(): FirmwareVariant[] {
  const dir = variantsDir()
  if (!existsSync(dir)) return []
  const out: FirmwareVariant[] = []
  for (const entry of readdirSync(dir)) {
    const sub = join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(sub).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) continue
    const config = readConfig(sub)
    for (const f of readdirSync(sub)) {
      if (!f.toLowerCase().endsWith('.uf2')) continue
      const p = join(sub, f)
      out.push({
        id: `${entry}/${f}`,
        variant: entry,
        label: prettyLabel(entry, f),
        uf2Path: p,
        sizeKB: Math.round(statSync(p).size / 1024),
        config
      })
    }
  }
  return out
}

/** Look for an RP2 bootloader mass-storage drive (D:..Z:) by its INFO_UF2.TXT.
 *
 *  Polled every 700 ms while waiting for a board to appear, so all 23 letters are
 *  tried at once and asynchronously: a card reader with no card, or a disconnected
 *  network drive, can take seconds to answer, and one of those would otherwise
 *  stall the whole app on every poll. Lowest letter wins, as before. */
export async function detectBoard(): Promise<BoardDrive | null> {
  const letters = Array.from({ length: 23 }, (_, i) => String.fromCharCode('D'.charCodeAt(0) + i))
  const found = await Promise.all(
    letters.map(async (letter) => {
      const drive = `${letter}:\\`
      // read straight through: a drive that is enumerated but not ready fails here
      // exactly as a missing one does, and both mean the same thing to us
      const txt = await readFile(join(drive, 'INFO_UF2.TXT'), 'utf8').catch(() => null)
      if (txt === null) return null
      const m = /Model:\s*(.+)/i.exec(txt)
      return { drive, model: m ? m[1].trim() : 'RP2 UF2 bootloader' }
    })
  )
  return found.find((b) => b !== null) ?? null
}

/** Get the Explorer window Windows opens on the bootloader drive out of the way.
 *
 *  A board entering the bootloader mounts as a removable drive, and on most PCs
 *  Windows answers that by opening a folder window on it — over the app, taking
 *  the keyboard, in the middle of a flash. There is no way to stop it opening
 *  from a normal application: AutoPlay can only be cancelled per-device through a
 *  COM interface that needs a native addon, and the registry switch that would do
 *  it turns AutoPlay off for every removable drive the user owns. Neither is a
 *  fair price for a window that lives ten seconds.
 *
 *  So it opens, and we move it aside — but only it. Shell.Application enumerates
 *  the open Explorer windows and we act on the ones whose location is this drive.
 *  A folder the operator opened themselves anywhere else is untouched.
 *
 *  Two actions, because they belong to two different moments. While the drive is
 *  live the window is only in the way, so it goes to the taskbar, where the
 *  operator can still reach it — minimising someone's window is a small liberty,
 *  closing it is a larger one. Once the flash is done the drive is gone with the
 *  reboot and the window points at nothing, so then it is closed.
 *
 *  Never throws: failing to tidy a window is not a reason to fail a flash. */
export async function dismissDriveWindow(drive: string, action: 'minimize' | 'close'): Promise<void> {
  if (process.platform !== 'win32') return
  // the letter comes from our own drive scan, but it ends up inside a shell
  // command — take only what a drive letter can be and nothing else
  const letter = /^([A-Za-z]):/.exec(drive)?.[1]
  if (!letter) return

  // SW_MINIMIZE (6), not SW_HIDE: hidden would take it off the taskbar too, and a
  // window the operator cannot get back to is not out of the way, it is lost.
  const act =
    action === 'close'
      ? `$w.Quit()`
      : `[N.W]::ShowWindow([IntPtr][int64]$w.HWND, 6)`
  const script =
    `$ErrorActionPreference='SilentlyContinue';` +
    (action === 'minimize'
      ? `Add-Type -Name W -Namespace N -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);';`
      : '') +
    `$s = New-Object -ComObject Shell.Application;` +
    `foreach ($w in @($s.Windows())) { if ($w.LocationURL -like 'file:///${letter}:*') { ${act} } }`
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
      { windowsHide: true, timeout: 15000 }
    )
  } catch {
    /* no Explorer window, COM refused, PowerShell missing — all harmless here */
  }
}

/** Open a file picker for a custom .uf2; returns absolute path or null. */
export async function pickUf2(): Promise<string | null> {
  const res = await dialog.showOpenDialog({
    title: 'Choose firmware (.uf2)',
    filters: [{ name: 'UF2 firmware', extensions: ['uf2'] }],
    properties: ['openFile']
  })
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
}

// UF2 block layout: 512 bytes each, three magics, and a family id saying which
// chip the payload is for. https://github.com/microsoft/uf2
const UF2_MAGIC0 = 0x0a324655
const UF2_MAGIC1 = 0x9e5d5157
const UF2_MAGIC_END = 0x0ab16f30
const FAMILY_RP2040 = 0xe48bff56
const FAMILY_RP2350 = new Set([0xe48bff59, 0xe48bff5a, 0xe48bff5b]) // ARM-S, RISC-V, ARM-NS

/** Read a .uf2 and refuse anything the board cannot safely take.
 *
 *  The bootloader is not a checker: it applies the blocks it recognises and
 *  ignores the rest, so a truncated file half-flashes and an image for the wrong
 *  chip flashes nothing — and both leave a board that boots into something other
 *  than what you chose. Neither says a word at the time. Since the whole file is
 *  read to copy it anyway, checking it first costs nothing worth counting.
 *
 *  Read asynchronously: this is the main process, and 875 KB off a slow drive is
 *  long enough to freeze the window mid-flash — which is exactly when the operator
 *  is watching it hardest.
 *
 *  Returns the image, which the caller then writes: reading it twice for the sake
 *  of a tidier signature would double the one part of this that is actually slow. */
async function verifyUf2(uf2Path: string, drive: string): Promise<Buffer> {
  const b = await readFile(uf2Path)
  if (b.length === 0 || b.length % 512 !== 0)
    throw new Error(`Not a UF2 image: ${b.length} bytes is not a whole number of 512-byte blocks.`)

  const families = new Set<number>()
  for (let o = 0; o < b.length; o += 512) {
    if (
      b.readUInt32LE(o) !== UF2_MAGIC0 ||
      b.readUInt32LE(o + 4) !== UF2_MAGIC1 ||
      b.readUInt32LE(o + 508) !== UF2_MAGIC_END
    )
      throw new Error(`Damaged UF2: block ${o / 512} has no valid header. Copy the file again.`)
    families.add(b.readUInt32LE(o + 28))
  }

  // Only judge the chip when the bootloader tells us which one it is; an
  // unfamiliar Model string should not stop a flash that would have worked.
  let model = ''
  try {
    model = await readFile(join(drive, 'INFO_UF2.TXT'), 'utf8')
  } catch {
    /* drive already gone or unreadable — the copy below will report it */
  }
  const payload = [...families].filter((f) => f !== 0xe48bff57 && f !== 0xe48bff58) // absolute/data carry no chip identity
  if (/RP2350/i.test(model) && payload.length && !payload.some((f) => FAMILY_RP2350.has(f)))
    throw new Error(
      payload.includes(FAMILY_RP2040)
        ? 'This image is built for the RP2040; the board is an RP2350. The bootloader would ignore it and the board would come back running the old firmware.'
        : 'This image is not built for the RP2350 on this board. The bootloader would ignore it.'
    )
  return b
}

/** How much of the image goes out at a time.
 *
 *  The bootloader writes each block into flash as it arrives, which is why a
 *  875 KB copy takes eight seconds and not the tenth of a second the size
 *  suggests. Awaiting one 64 KB write at a time (128 UF2 blocks) is what turns
 *  that wait into something a progress bar can honestly report: the count moves
 *  only once the drive has actually taken the bytes, not once we have handed them
 *  to the OS. Smaller chunks would report more smoothly and copy more slowly. */
const CHUNK = 64 * 1024

/** Copy the .uf2 onto the bootloader drive. The board reboots on completion.
 *
 *  Logged with the file's full path, size and mtime. A flash is the one action
 *  that can change everything about how the board behaves, and until now it was
 *  the one action that left no trace: on 29 Jul 2026 a board went mute right
 *  after a flash and the log could not say which image had been put on it — the
 *  question the whole diagnosis turned on. Three lines, written before the copy
 *  so a failed copy is on record too. */
export async function flashFile(
  uf2Path: string,
  drive: string,
  onProgress?: (p: FlashProgress) => void
): Promise<void> {
  const st = await stat(uf2Path).catch(() => null)
  if (!st) throw new Error(`UF2 not found: ${uf2Path}`)
  await access(drive).catch(() => {
    throw new Error(`Bootloader drive not available: ${drive}`)
  })
  log('app', `flashing ${uf2Path} → ${drive} (${Math.round(st.size / 1024)} KB, built ${st.mtime.toISOString()})`)

  onProgress?.({ phase: 'verify', done: 0, total: st.size })
  const image = await verifyUf2(uf2Path, drive)

  const fh = await open(join(drive, 'firmware.uf2'), 'w')
  try {
    for (let at = 0; at < image.length; at += CHUNK) {
      const n = Math.min(CHUNK, image.length - at)
      await fh.write(image, at, n)
      onProgress?.({ phase: 'write', done: at + n, total: image.length })
    }
  } finally {
    // The board reboots the instant the last block lands, so the drive can vanish
    // under us before close() returns. That is a successful flash, not a failure.
    await fh.close().catch(() => {})
  }
  log('app', 'flash written — the board reboots into it now')
}
