/**
 * What the machine is left able to do after it refuses a line.
 *
 * grblHAL latches the rejection. With COMPATIBILITY_LEVEL 0 — the default, and what
 * our firmware builds with — protocol.c parses a block only while gc_state.last_error
 * is clear, and reports the OLD error for every line after it. So a refused line does
 * not just fail: the machine then refuses everything, answering with a code that has
 * nothing to do with what was sent.
 *
 * Found against the grblHAL simulator on 5 Aug 2026 and confirmed on the board the
 * same day, on a machine sitting Idle with no alarm:
 *
 *     M99  ->  error:20
 *     G21  ->  error:20      <- a line that changes nothing, refused
 *
 * The way out is the firmware's own: an empty line, which protocol.c handles as
 * "Empty line. For syncing purposes.". These check that one goes out, and that it is
 * metered when a program is streaming — writing past the character counting is the
 * bug fixed on 1 Aug and one byte is not a reason to reintroduce it.
 *
 *   npm test                          the working tree
 *   OLD=643c711 node test/run.mjs     the commit before the fix — section 1 fails
 */
import { Controller } from '../src/main/controller'
import * as fakeSerial from './fakes/serial'
import type { ControllerEvent } from '@shared/types'

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
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

async function connected(): Promise<{ ctl: Controller; port: fakeSerial.SerialTransport; seen: ControllerEvent[] }> {
  const seen: ControllerEvent[] = []
  const ctl = new Controller((e) => seen.push(e))
  await ctl.connect({ kind: 'usb', port: 'COM_TEST', baud: 115200 })
  const port = fakeSerial.last as fakeSerial.SerialTransport
  port.lines.length = 0
  port.realtime.length = 0
  seen.length = 0
  return { ctl, port, seen }
}

export async function main(): Promise<number> {
  console.log('\n1. a rejection leaves the machine able to take the next command')
  {
    const { ctl, port, seen } = await connected()

    // The operator mistypes in the console, machine idle.
    ctl.sendLine('M99')
    port.feed('error:20')
    await tick()

    ok(port.lines.includes(''), 'a sync line went out after the rejection')
    eq(port.lines.filter((l) => l === '').length, 1, 'exactly one — not one per line thereafter')

    // …and its `ok` is not shown as though it answered the operator.
    const before = seen.filter((e) => e.type === 'line').length
    port.feed('ok')
    await tick()
    const after = seen.filter((e) => e.type === 'line').length
    eq(after - before, 0, "the sync's own ok is swallowed, not printed under the error")

    // A real reply still gets through.
    port.feed('ok')
    await tick()
    ok(seen.filter((e) => e.type === 'line').length > before, 'the next genuine ok is not swallowed with it')
  }

  console.log('\n2. …and a job that dies on a bad line does not leave a deaf machine')
  {
    const { ctl, port } = await connected()
    ctl.startJob(['G0 X0', 'G1 X10 F100', 'G1 X20 Q7', 'G1 X30'].join('\n'))
    await tick()
    port.feed('ok') // G0 X0
    port.feed('ok') // G1 X10
    await tick()
    port.lines.length = 0
    port.feed('error:36') // the third line is refused — the job aborts
    await tick()

    eq(ctl.isRunning, false, 'the job was torn down')
    ok(port.lines.includes(''), 'and a sync line followed it')
    ok(
      port.lines.indexOf('') === port.lines.length - 1,
      'sent after the teardown, so resetJob cannot drop it with the rest of the queue'
    )
  }

  console.log('\n3. while a program streams, the sync is metered like everything else')
  {
    const { ctl, port } = await connected()
    const prog = Array.from({ length: 12 }, (_, i) => `G1 X${String(i).padStart(3, '0')} Y000 F100`)

    // Mirror grblHAL's RX buffer from the outside: every line written costs its bytes
    // plus the newline, every reply frees the oldest. The sync is one byte and will
    // almost always fit — so "did it wait?" measures nothing. What matters is that it
    // is counted at all, and this is the only way to see that from here.
    const inflight: number[] = []
    let counted = 0
    const record = (): void => {
      for (; counted < port.lines.length; counted++) inflight.push(port.lines[counted].length + 1)
    }
    const bytes = (): number => inflight.reduce((a, b) => a + b, 0)
    let worst = 0
    const reply = async (r: string): Promise<void> => {
      record()
      inflight.shift()
      port.feed(r)
      await tick()
      record()
      worst = Math.max(worst, bytes())
    }

    ctl.startJob(prog.join('\n'))
    await tick()
    record()
    worst = Math.max(worst, bytes())
    ok(port.lines.length < prog.length, `the buffer filled rather than flushing the file (${port.lines.length}/${prog.length})`)

    // An operator line is refused mid-cut. Replies come back in the order the lines
    // were written, so the rejection only belongs to M99 once everything queued ahead
    // of it has been answered — six program lines. Getting that wrong is what the
    // first draft of this test did: the error landed on a program line, the job
    // aborted for the right reason, and the check measured the wrong thing.
    ctl.sendLine('M99')
    await reply('ok') // frees a slot; the manual line goes out behind the program
    for (let i = 0; i < 6; i++) await reply('ok')
    await reply('error:20') // now this one is M99's

    eq(ctl.isRunning, true, 'the operator typo did not kill the program')
    ok(port.lines.includes(''), 'a sync line went out with the program still streaming')
    ok(worst < 127, `and the RX buffer was never overfilled (worst ${worst} bytes)`)
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  return failures
}
