/**
 * Runs the main-process tests. There is no test framework here on purpose — these
 * bundle the real source with esbuild (already present via vite) and run it on
 * plain node, so the suite costs nothing to keep and nothing to install.
 *
 * Only the parts of controller.ts that touch the OS are replaced (serial port,
 * disk logging, the settings backup); the protocol code under test is the real
 * file, imported from src/.
 *
 *   node test/run.mjs                  the working tree
 *   OLD=a1674a0 node test/run.mjs      controller.ts as it was at that commit
 *
 * The OLD form is how you check that a test actually catches the bug it describes:
 * write the test, watch it fail against the commit before the fix, then pass.
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TEST = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(TEST, '..')
const SRC = path.join(ROOT, 'src')
const work = mkdtempSync(path.join(tmpdir(), 'rectatest-'))

/** Relative imports of controller.ts that reach the OS, and what to use instead. */
const FAKES = {
  './transport/serial': 'serial',
  './transport/ethernet': 'ethernet',
  './logger': 'logger',
  './settingsBackup': 'settingsBackup',
  './rescue': 'rescue'
}

// OLD=<rev>: pull that revision's controller out of git and test it instead.
let controller = null
if (process.env.OLD) {
  const rev = process.env.OLD
  const src = execFileSync('git', ['show', `${rev}:src/main/controller.ts`], { cwd: ROOT, encoding: 'utf8' })
  controller = path.join(work, 'controller.ts')
  writeFileSync(controller, src)
  console.log(`testing controller.ts from ${rev}`)
}

const out = path.join(work, 'suite.mjs')
await build({
  entryPoints: [path.join(TEST, 'stream.test.ts')],
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  plugins: [
    {
      name: 'fakes',
      setup(b) {
        b.onResolve({ filter: /^\.\/(transport\/(serial|ethernet)|logger|settingsBackup|rescue)$/ }, (a) =>
          a.importer.endsWith('controller.ts') ? { path: path.join(TEST, 'fakes', `${FAKES[a.path]}.ts`) } : undefined
        )
        b.onResolve({ filter: /^@shared\// }, (a) => ({ path: path.join(SRC, 'shared', `${a.path.slice(8)}.ts`) }))
        if (controller)
          b.onResolve({ filter: /(^|\/)src\/main\/controller$/ }, () => ({ path: controller }))
      }
    }
  ]
})

await import(pathToFileURL(out).href)
