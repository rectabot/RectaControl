/**
 * Runs every test/*.test.ts. There is no test framework here on purpose — these bundle
 * the real source with esbuild (already present via vite) and run it on plain node, so
 * the suite costs nothing to keep and nothing to install.
 *
 * What is under test is the code that decides what the machine does with no way to see
 * it from outside: the streaming flow control (stream.test.ts) and the cursor that maps
 * tool position to G-code line, which is where Park and Resume get their line number
 * from (tracker.test.ts). Only the parts that touch the OS are replaced (serial port,
 * disk logging, the settings backup).
 *
 *   node test/run.mjs                  the working tree
 *   OLD=a1674a0 node test/run.mjs      controller.ts as it was at that commit
 *
 * The OLD form is how you check that a test actually catches the bug it describes:
 * write the test, watch it fail against the commit before the fix, then pass.
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
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

// Every test/*.test.ts, bundled into one file and run in one process — the suites are
// small and independent, and a single build keeps the whole thing under a second. Each
// exports main(), which prints its own results and returns the number of failures.
const files = readdirSync(TEST)
  .filter((f) => f.endsWith('.test.ts'))
  .sort()
const entry = path.join(work, 'all.ts')
writeFileSync(
  entry,
  [
    ...files.map((f, i) => `import { main as m${i} } from ${JSON.stringify(path.join(TEST, f).replace(/\\/g, '/'))}`),
    'let failures = 0',
    ...files.map((f, i) => `console.log('\\n=== ${f} ===')\nfailures += await m${i}()`),
    "console.log(failures ? `\\n${failures} check(s) FAILED` : '\\nall suites passed')",
    'process.exit(failures ? 1 : 0)'
  ].join('\n')
)

const out = path.join(work, 'suite.mjs')
await build({
  entryPoints: [entry],
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
        // The serialport package itself, for usb.test.ts — which tests the real
        // transport/serial.ts rather than a stand-in for it, because the rules under
        // test (which port is a board, what it has to answer) live in that file. The
        // package is a native binding built for Electron and would not load on plain
        // node anyway.
        b.onResolve({ filter: /^serialport$/ }, () => ({ path: path.join(TEST, 'fakes', 'serialport.ts') }))
        b.onResolve({ filter: /^@shared\// }, (a) => ({ path: path.join(SRC, 'shared', `${a.path.slice(8)}.ts`) }))
        if (controller)
          b.onResolve({ filter: /(^|\/)src\/main\/controller$/ }, () => ({ path: controller }))
      }
    }
  ]
})

await import(pathToFileURL(out).href)
