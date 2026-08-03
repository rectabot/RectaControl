/**
 * The Ethernet link: what counts as a connection, and when a connection is replaced.
 *
 * Both halves of this were live on 3 Aug 2026 and together they cost 17 minutes of a
 * machine that was sitting right there, reachable. The app was open while the renderer
 * was being rebuilt; the reloaded window ran its startup auto-connect, the controller
 * dropped its own healthy socket and asked for a new one 2 ms later, and grblHAL's
 * telnet daemon — which serves one client — was still holding the old session. From
 * then on every attempt completed the TCP handshake and was reset a millisecond later,
 * and every one of them was reported as a successful connection. The reconnect chase
 * called itself done, the drop started a fresh chase, and the give-up after 14 tries
 * was never reached once in 503 sockets.
 *
 * So: a socket that dies on arrival is not a connection (section 1), and a window that
 * comes back is not a reason to drop the link it came back to (section 2).
 *
 *   npm test      runs this with the rest
 */
import net from 'node:net'
import { EthernetTransport } from '../src/main/transport/ethernet'
import { Controller } from '../src/main/controller'
import * as fakeEth from './fakes/ethernet'
import { BUSY_SESSION } from '@shared/types'
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
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A telnet server that behaves however this test needs it to, on a free port. */
async function serve(onConn: (s: net.Socket) => void): Promise<{ port: number; stop: () => Promise<void> }> {
  const srv = net.createServer(onConn)
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const port = (srv.address() as net.AddressInfo).port
  return {
    port,
    stop: () => new Promise<void>((r) => srv.close(() => r()))
  }
}

export async function main(): Promise<number> {
  console.log('\n1. a session the board drops on arrival is not a connection')
  {
    // grblHAL with a client already attached: the handshake completes, then the socket
    // goes. This is what the app saw 503 times, and used to call "connected over ethernet".
    const { port, stop } = await serve((s) => s.destroy())
    const t = new EthernetTransport('127.0.0.1', port)
    let closes = 0
    t.onClose(() => closes++)

    const err = await t
      .open()
      .then(() => null)
      .catch((e: Error) => e)

    ok(err !== null, 'open() rejected instead of reporting a connection')
    ok(String(err?.message ?? '').includes(BUSY_SESSION), 'and said WHY — the board is holding an earlier session')
    eq(t.isOpen, false, 'the transport is not open')
    await wait(50)
    eq(closes, 0, 'and nothing was reported as a link that dropped — there was no link')
    await stop()
  }

  console.log('\n2. a board that answers is a connection, and its first words are not lost')
  {
    // The greeting arrives about a millisecond after the socket opens. It is proof of
    // life, so the connection is accepted the moment it lands rather than sitting out
    // the probation — but it must still reach the parser.
    const { port, stop } = await serve((s) => s.write("GrblHAL 1.1f ['$' or '$HELP' for help]\r\n"))
    const t = new EthernetTransport('127.0.0.1', port)
    const heard: string[] = []
    t.onData((c) => heard.push(c.toString()))

    const t0 = Date.now()
    await t.open()
    const took = Date.now() - t0

    eq(t.isOpen, true, 'the transport is open')
    ok(took < 400, `a board that speaks is accepted at once, not after the full wait (${took} ms)`)
    eq(heard.length, 0, 'nothing was parsed before the app was told there is a connection')
    await wait(20)
    ok(heard.join('').includes('GrblHAL'), 'the greeting was held during probation and delivered, not swallowed')
    await t.close()
    await stop()
  }

  console.log('\n3. a silent-but-healthy board is accepted once it has held the line')
  {
    // Nothing is sent until the app asks, which it does after this returns. The only
    // evidence available is that the socket is still up.
    const { port, stop } = await serve(() => {})
    const t = new EthernetTransport('127.0.0.1', port)
    const t0 = Date.now()
    await t.open()
    const took = Date.now() - t0
    eq(t.isOpen, true, 'the transport is open')
    ok(took >= 400, `it waited out the probation before believing it (${took} ms)`)
    await t.close()
    await stop()
  }

  console.log('\n4. a link that drops later is reported — once')
  {
    // 'close' and 'error' both arrive when a peer resets a socket. Both used to be
    // passed up, which is why the log carries two disconnect lines per drop.
    const { port, stop } = await serve((s) => setTimeout(() => s.destroy(), 600))
    const t = new EthernetTransport('127.0.0.1', port)
    let closes = 0
    t.onClose(() => closes++)
    await t.open()
    eq(t.isOpen, true, 'connected first')
    await wait(400)
    eq(closes, 1, 'the drop was reported exactly once')
    await stop()
  }

  console.log('\n5. a reloaded window rejoins the link instead of tearing it down')
  {
    // The renderer is not where the link lives. A rebuild, an F5 or a recovered crash
    // brings up an App.tsx that knows nothing and runs its startup auto-connect; that
    // must not cost the machine its session.
    const events: ControllerEvent[] = []
    const c = new Controller((e) => events.push(e))
    const board = { kind: 'ethernet', host: '192.168.5.1', port: 23 } as const

    await c.connect({ ...board })
    eq(fakeEth.opened.length, 1, 'the first connect opened a socket')

    const before = events.filter((e) => e.type === 'connected').length
    await c.connect({ ...board })
    eq(fakeEth.opened.length, 1, 'asking for the SAME board again opened no second socket')
    eq(
      events.filter((e) => e.type === 'connected').length,
      before + 1,
      'and the window was told it is connected, so it can fill itself in'
    )
    ok(
      !events.some((e) => e.type === 'disconnected'),
      'the machine never saw a disconnect (this is the one that locked us out)'
    )

    // Auto-connect is the one the reloaded window actually calls, and it used to make the
    // cable decision again from scratch — which on a rig connected over USB for a flash
    // meant dropping that link to go looking for the network.
    const kind = await c.autoConnect({ ethHost: board.host, ethPort: board.port, baud: 115200 })
    eq(fakeEth.opened.length, 1, 'auto-connect on a live link opened no socket either')
    eq(kind, 'ethernet', 'and reported the cable that is actually up')

    // A different board IS a replacement — and the old session is given a moment to be
    // let go before the new one is asked for, which is what the 2 ms gap skipped.
    const t0 = Date.now()
    await c.connect({ kind: 'ethernet', host: '192.168.5.2', port: 23 })
    const took = Date.now() - t0
    eq(fakeEth.opened.length, 2, 'a different board opened a new socket')
    ok(took >= 250, `and the old session was released first (${took} ms)`)
    await c.disconnect()
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  return failures
}
