/** SD-card file management over the grblHAL FTP server (port 21).
 *  grblHAL serves the SD card as the FTP root "/". A fresh client is opened per
 *  operation — simplest and most robust against the controller's lightweight ftpd
 *  dropping idle connections. (Optimize to a pooled connection later if needed.) */

import { Client, type FileInfo } from 'basic-ftp'
import { dialog } from 'electron'
import { Readable } from 'node:stream'
import { basename, join } from 'node:path'
import type { FmEntry } from '@shared/types'
import { libraryDir } from './library'

const FTP_PORT = 21
const TIMEOUT_MS = 8000

async function withClient<T>(host: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client(TIMEOUT_MS)
  client.ftp.verbose = false
  try {
    // WebUI auth is disabled on the board → anonymous login is accepted.
    await client.access({ host, port: FTP_PORT, user: 'anonymous', password: 'anonymous', secure: false })
    return await fn(client)
  } finally {
    client.close()
  }
}

function joinRemote(dir: string, name: string): string {
  return (dir.endsWith('/') ? dir : dir + '/') + name
}

export async function fmList(host: string, dir: string): Promise<FmEntry[]> {
  return withClient(host, async (c) => {
    const list = await c.list(dir || '/')
    return list
      .map((f: FileInfo) => ({ name: f.name, isDir: f.isDirectory, size: f.size }))
      .filter((e) => e.name !== '.' && e.name !== '..')
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  })
}

export async function fmDelete(host: string, path: string, isDir: boolean): Promise<void> {
  return withClient(host, async (c) => {
    if (isDir) await c.removeDir(path)
    else await c.remove(path)
  })
}

export async function fmRename(host: string, from: string, to: string): Promise<void> {
  await withClient(host, (c) => c.rename(from, to))
}

export async function fmMkdir(host: string, dir: string, name: string): Promise<void> {
  await withClient(host, (c) => c.send('MKD ' + joinRemote(dir, name)))
}

/** Pick local file(s) and upload them into the remote directory. Returns names uploaded. */
export async function fmUpload(host: string, remoteDir: string): Promise<string[]> {
  const res = await dialog.showOpenDialog({
    title: 'Choose files to upload',
    properties: ['openFile', 'multiSelections']
  })
  if (res.canceled || res.filePaths.length === 0) return []
  return withClient(host, async (c) => {
    const names: string[] = []
    for (const local of res.filePaths) {
      const name = basename(local)
      await c.uploadFrom(local, joinRemote(remoteDir, name))
      names.push(name)
    }
    return names
  })
}

/** Overwrite (or create) a file on the SD card with the given text content. */
export async function fmUploadContent(host: string, remotePath: string, content: string): Promise<void> {
  await withClient(host, (c) => c.uploadFrom(Readable.from(Buffer.from(content, 'utf8')), remotePath))
}

/** Download a remote file straight into the PC g-code library. Returns the name. */
export async function fmDownloadToLib(host: string, remotePath: string): Promise<string> {
  const name = basename(remotePath)
  const dest = join(libraryDir(), name)
  await withClient(host, (c) => c.downloadTo(dest, remotePath))
  return name
}

/** Download a remote file to a user-chosen local path. Returns the saved path or null. */
export async function fmDownload(host: string, remotePath: string): Promise<string | null> {
  const res = await dialog.showSaveDialog({
    title: 'Save file',
    defaultPath: basename(remotePath)
  })
  if (res.canceled || !res.filePath) return null
  const dest = res.filePath
  await withClient(host, (c) => c.downloadTo(dest, remotePath))
  return dest
}
