/** Local g-code library — a predefined folder on the PC that RectaControl owns,
 *  so loading/saving programs never needs the native file dialog. Files live in
 *  <Documents>/RectaControl/gcode (override with RECTA_GCODE_DIR). */

import { app, dialog, shell } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import type { FmEntry } from '@shared/types'

const EXTS = ['.nc', '.gcode', '.gc', '.tap', '.ngc', '.txt', '.cnc']

/** The library folder, created on first use. */
export function libraryDir(): string {
  const dir = process.env.RECTA_GCODE_DIR || join(app.getPath('documents'), 'RectaControl', 'gcode')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Keep callers to a bare filename inside the library (no path traversal). */
function safeName(name: string): string {
  const base = basename(name).trim()
  if (!base || base === '.' || base === '..') throw new Error('Invalid file name.')
  return base
}

/** List program files in the library. */
export function libList(): FmEntry[] {
  const dir = libraryDir()
  const out: FmEntry[] = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    try {
      const st = statSync(p)
      if (!st.isFile()) continue
      if (!EXTS.includes(f.slice(f.lastIndexOf('.')).toLowerCase())) continue
      out.push({ name: f, isDir: false, size: st.size })
    } catch {
      /* skip unreadable entries */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function libRead(name: string): string {
  return readFileSync(join(libraryDir(), safeName(name)), 'utf8')
}

export function libWrite(name: string, content: string): void {
  writeFileSync(join(libraryDir(), safeName(name)), content, 'utf8')
}

export function libDelete(name: string): void {
  rmSync(join(libraryDir(), safeName(name)), { force: true })
}

/** Open the library folder in the OS file explorer. */
export function libReveal(): void {
  shell.openPath(libraryDir())
}

/** Import file(s) from the PC into the library (one-off native picker). Returns
 *  the names that were copied in. */
export async function libImport(): Promise<string[]> {
  const res = await dialog.showOpenDialog({
    title: 'Uvezi G-code u biblioteku',
    filters: [{ name: 'G-code', extensions: EXTS.map((e) => e.slice(1)) }],
    properties: ['openFile', 'multiSelections']
  })
  if (res.canceled || res.filePaths.length === 0) return []
  const dir = libraryDir()
  const names: string[] = []
  for (const src of res.filePaths) {
    const name = basename(src)
    copyFileSync(src, join(dir, name))
    names.push(name)
  }
  return names
}
