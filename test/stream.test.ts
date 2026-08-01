/**
 * Flow-control tests for the streaming half of controller.ts.
 *
 * This is the one part of the app where a mistake mangles a G-code line inside the
 * machine rather than on screen, and the failure is invisible from outside: the
 * board silently drops whatever will not fit in its 127-byte RX buffer. So the
 * tests drive the REAL controller through a fake serial port (test/fakes/) and
 * assert the two things a machine cannot show you — how many bytes the app thinks
 * are in that buffer, and whose `ok` each reply was counted against.
 *
 *   npm run test:stream            run against the working tree
 *   OLD=<git-rev> npm run test:stream    run against controller.ts from that rev,
 *                                        to check a test really does catch the bug
 *                                        it claims to (see test/run.mjs)
 */
import { Controller } from '../src/main/controller'
import * as fake from './fakes/serial'
import type { ControllerEvent, JobProgress } from '@shared/types'

const RX = 127 // must match RX_BUFFER in controller.ts

let failures = 0
let checks = 0

function ok(cond: boolean, what: string): void {
  checks++
  if (cond) console.log(`  ok   ${what}`)
  else {
    failures++
    console.log(`  FAIL ${what}`)
  }
}
function eq(actual: unknown, expected: unknown, what: string): void {
  ok(actual === expected, `${what} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

/** 20-char program lines → 21 bytes each → six fit in 127, a seventh does not. */
const prog = (n: number): string =>
  Array.from({ length: n }, (_, i) => `G1X${String(i).padStart(6, '0')}Y000000F900`).join('\n')

const isProgram = (line: string): boolean => /^G1X/.test(line)

type Rig = {
  c: Controller
  t: fake.SerialTransport
  /** lines written but not yet answered — the app's view of the board's RX buffer */
  unacked: () => string[]
  bytesInFlight: () => number
  /** feed one reply line from the board */
  reply: (line: string) => void
  lastJob: () => JobProgress | undefined
  /** how far into the file the app CLAIMS to be, read off the editor highlight */
  progress: () => number
  /** how many program lines the board has actually answered */
  programsAcked: () => number
}

async function rig(): Promise<Rig> {
  const events: ControllerEvent[] = []
  const c = new Controller((e) => events.push(e))
  await c.connect({ kind: 'usb', port: 'FAKE', baud: 115200 })
  const t = fake.last as fake.SerialTransport
  t.lines.length = 0 // drop the $I / $G the connect queued
  let answered = 0
  const unacked = (): string[] => t.lines.slice(answered)
  return {
    c,
    t,
    unacked,
    bytesInFlight: () => unacked().reduce((a, l) => a + l.length + 1, 0),
    reply: (line: string): void => {
      if (line === 'ok' || /^error:/.test(line)) answered++
      t.feed(line)
    },
    lastJob: () => {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'job') return events[i].data as JobProgress
      return undefined
    },
    // The 'active' event IS the progress signal: it carries the file line the editor
    // highlight sits on, one per program ack. Its high-water mark is the app's claim.
    progress: () => {
      let hi = -1
      for (const e of events) if (e.type === 'active' && (e.data as number) > hi) hi = e.data as number
      return hi + 1
    },
    programsAcked: () => t.lines.slice(0, answered).filter(isProgram).length
  }
}

async function main(): Promise<void> {
  console.log('\n1. the program alone stays inside the 127-byte window')
  {
    const r = await rig()
    r.c.startJob(prog(20))
    eq(r.t.lines.length, 6, 'six 21-byte lines fit before the buffer is full')
    ok(r.bytesInFlight() < RX, `in flight ${r.bytesInFlight()} < ${RX}`)
    r.reply('ok')
    eq(r.t.lines.length, 7, 'one ack lets exactly one more line out')
    ok(r.bytesInFlight() < RX, `in flight ${r.bytesInFlight()} < ${RX}`)
  }

  console.log('\n2. a manual line during a job must not overfill the buffer')
  {
    const r = await rig()
    r.c.startJob(prog(20))
    const before = r.t.lines.length
    r.c.sendLine('M64 P0') // VAC on, mid-cut
    r.c.sendLine('M65 P0')
    r.c.sendLine('$#')
    r.c.sendLine('$$')
    eq(r.t.lines.length, before, 'the buffer was full: not one manual byte went out early')
    r.reply('ok')
    eq(r.t.lines[before], 'M64 P0', 'the freed slot goes to the manual line, ahead of the program')
    for (let i = 0; i < 12; i++) {
      r.reply('ok')
      ok(r.bytesInFlight() < RX, `in flight ${r.bytesInFlight()} < ${RX} after ack ${i + 2}`)
    }
  }

  console.log("\n3. a manual line's ok must never be counted as program progress")
  {
    // Ack a whole run one reply at a time with manual lines mixed in, holding the app
    // to the invariant that matters: it may never claim to have got further through
    // the file than the number of PROGRAM lines the board has answered.
    const r = await rig()
    r.c.startJob(prog(20))
    let movedByManual = ''
    let ranAhead = ''
    let manualReplies = 0
    for (let n = 0; n < 30; n++) {
      if (n % 3 === 0) r.c.sendLine(`M64 P${n}`) // operator poking at buttons mid-cut
      const next = r.unacked()[0]
      if (next === undefined) break
      const wasProgram = isProgram(next)
      const before = r.progress()
      r.reply('ok')
      const moved = r.progress() - before
      if (!wasProgram) {
        manualReplies++
        if (moved !== 0 && !movedByManual) movedByManual = `reply ${n} answered a manual line but moved progress by ${moved}`
      }
      // The highlight is seeded on line 1 before any ack, so it may lead by one at the
      // very start; what it must never do is get ahead of the acked program lines.
      if (r.progress() > Math.max(1, r.programsAcked()) && !ranAhead)
        ranAhead = `after reply ${n} progress was ${r.progress()} with only ${r.programsAcked()} program lines acked`
    }
    ok(manualReplies >= 5, `the run really did mix manual lines in (${manualReplies} manual replies)`)
    ok(!movedByManual, movedByManual || 'no manual reply ever moved progress')
    ok(!ranAhead, ranAhead || 'progress never ran ahead of the program lines the board answered')
    eq(r.progress(), r.programsAcked(), 'progress ends equal to the program lines acked')
  }

  console.log('\n4. five program lines with four VAC lines mixed in')
  {
    const r = await rig()
    r.c.startJob(prog(5))
    eq(r.t.lines.length, 5, 'all five program lines fit in the buffer')
    for (let i = 0; i < 4; i++) r.c.sendLine(`M64 P${i}`)
    eq(r.t.lines.length, 8, 'three VAC lines fit, the fourth waits for room')
    for (let i = 0; i < 5; i++) r.reply('ok') // the five program lines
    eq(r.progress(), 5, 'progress reached exactly five')
    ok(r.lastJob()?.running === false, 'the job is finished — all five program lines are acked')
    ok(r.t.lines.includes('M64 P3'), 'the VAC line still owed was flushed, not swallowed')
  }

  console.log('\n5. an error on a MANUAL line does not kill the job')
  {
    const r = await rig()
    r.c.startJob(prog(20))
    r.reply('ok')
    r.c.sendLine('G0 Z') // operator typo, queued behind the lines already out
    r.reply('ok')
    ok(r.t.lines.includes('G0 Z'), 'the typo was sent')
    while (r.unacked()[0] !== 'G0 Z') r.reply('ok') // ack down to it, as the board would
    r.reply('error:20') // …and this is the reply the typo earns
    ok(r.lastJob()?.running === true, 'the job survives the operator typo')
    const p = r.progress()
    r.reply('ok')
    eq(r.progress(), p + 1, 'and keeps counting program lines afterwards')
  }

  console.log('\n6. an error on a PROGRAM line still aborts')
  {
    const r = await rig()
    r.c.startJob(prog(20))
    r.reply('error:20')
    ok(r.lastJob()?.running === false, 'the job aborted')
  }

  console.log('\n7. resume after a hold restarts the stream')
  {
    const r = await rig()
    r.c.startJob(prog(20))
    r.c.pauseJob()
    // grblHAL acks a line when it parses it into the planner, not when it cuts it, so
    // a hold keeps acking until nothing is left in flight.
    for (let i = 0; i < 6; i++) r.reply('ok')
    eq(r.bytesInFlight(), 0, 'nothing left in flight — the hold drained it')
    const before = r.t.lines.length
    r.c.resumeJob()
    ok(r.t.lines.length > before, 'resume pumped more lines (without this the job hangs)')
  }

  console.log('\n8. Stop drops a queued manual line instead of firing it afterwards')
  {
    const r = await rig()
    r.c.startJob(prog(20))
    r.c.sendLine('G0 X100 Y100') // queued behind a full buffer
    const before = r.t.lines.length
    r.c.stopJob()
    eq(r.t.lines.length, before, 'the stale motion command was NOT written after the reset')
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  process.exit(failures ? 1 : 0)
}

void main()
