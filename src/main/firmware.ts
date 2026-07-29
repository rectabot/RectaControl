/** Firmware flashing helpers (RP2350 UF2 bootloader).
 *
 *  Flow: the board enters the bootloader via the grblHAL `$UF2` command (or a
 *  manual BOOT+RUN), mounts as a FAT drive containing INFO_UF2.TXT, and we flash
 *  by copying a .uf2 file onto it. The board reboots into the new firmware. */

import { app, dialog } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardDrive, FirmwareVariant } from '@shared/types'

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
  const map: Record<string, string> = {
    '3axis': '3-axis (X/Y/Z)',
    '3axis-ganged-y': '3-axis + dual-Y gantry (ganged)',
    '3axis-autosquare-y': '3-axis + dual-Y gantry (auto-square)',
    '4axis-rotary-a': '4-axis (X/Y/Z + rotary A)',
    '4axis-a-ganged-y': '4-axis + dual-Y gantry, rotary A',
    '4axis-a-autosquare-y': '4-axis + dual-Y auto-square, rotary A',
    '5axis': '5-axis (X/Y/Z/A/B)'
  }
  const name = map[folder] ?? folder
  // Show the version from the .uf2 name (…_v1.0.uf2) instead of the whole filename.
  const ver = /_v([\d.]+)\.uf2$/i.exec(file)
  return ver ? `${name} (v${ver[1]})` : `${name} — ${file}`
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
    for (const f of readdirSync(sub)) {
      if (!f.toLowerCase().endsWith('.uf2')) continue
      const p = join(sub, f)
      out.push({
        id: `${entry}/${f}`,
        label: prettyLabel(entry, f),
        uf2Path: p,
        sizeKB: Math.round(statSync(p).size / 1024)
      })
    }
  }
  return out
}

/** Look for an RP2 bootloader mass-storage drive (D:..Z:) by its INFO_UF2.TXT. */
export function detectBoard(): BoardDrive | null {
  for (let c = 'D'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const drive = `${String.fromCharCode(c)}:\\`
    const info = join(drive, 'INFO_UF2.TXT')
    try {
      if (!existsSync(info)) continue
      const txt = readFileSync(info, 'utf8')
      const m = /Model:\s*(.+)/i.exec(txt)
      return { drive, model: m ? m[1].trim() : 'RP2 UF2 bootloader' }
    } catch {
      // drive enumerated but not ready — skip
    }
  }
  return null
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

/** Copy the .uf2 onto the bootloader drive. The board reboots on completion. */
export function flashFile(uf2Path: string, drive: string): void {
  if (!existsSync(uf2Path)) throw new Error(`UF2 not found: ${uf2Path}`)
  if (!existsSync(drive)) throw new Error(`Bootloader drive not available: ${drive}`)
  copyFileSync(uf2Path, join(drive, 'firmware.uf2'))
}
