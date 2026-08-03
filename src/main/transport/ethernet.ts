/** Ethernet transport — raw TCP to the grblHAL telnet server (W5500, port 23). */

import net from 'node:net'
import { BUSY_SESSION } from '@shared/types'
import type { Transport } from './index'

/** How long a fresh session must survive before it counts as a connection.
 *
 *  grblHAL's telnet daemon serves one client. When it already has one it still completes
 *  the TCP handshake and only then drops the new socket — so `connect` firing proves the
 *  board's network stack is alive, and proves nothing at all about whether we are talking
 *  to it. On 3 Aug 2026 that cost 17 minutes: every attempt was declared a connection,
 *  the reconnect chase called itself successful, the reset a millisecond later started a
 *  fresh chase, and the give-up after 14 tries was never once reached. 503 sockets.
 *
 *  Measured on that log the drop lands within 1-2 ms; the slowest of the 503 took 214 ms.
 *  Half a second is comfortably past that and short enough to be invisible on a healthy
 *  connect — which pays it in full, since the board says nothing until it is asked. */
const SETTLE_MS = 500

export class EthernetTransport implements Transport {
  private socket: net.Socket | null = null
  private dataCb: (chunk: Buffer) => void = () => {}
  private closeCb: (reason?: string) => void = () => {}

  constructor(
    private host: string,
    private port = 23
  ) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.host, port: this.port })
      const timer = setTimeout(() => {
        sock.destroy()
        this.socket = null
        reject(
          new Error(
            `The board is not responding at ${this.host}:${this.port} — check the IP, the telnet service and that you are on the same subnet`
          )
        )
      }, 4000)
      const onError = (e: Error): void => {
        clearTimeout(timer)
        this.socket = null
        reject(e)
      }
      sock.once('error', onError)
      sock.once('connect', () => {
        clearTimeout(timer)
        sock.removeListener('error', onError)
        sock.setNoDelay(true)
        this.socket = sock

        // The session is on probation until SETTLE_MS is up. Anything the board sends in
        // that window is held rather than forwarded — the greeting is the usual case, and
        // handing it up before `connected` would have the app parsing lines from a
        // connection it has not been told about yet. It is flushed, in order, on the way
        // out of probation.
        let settled = false
        const held: Buffer[] = []
        sock.on('data', (chunk: Buffer) => (settled ? this.dataCb(chunk) : held.push(chunk)))

        const accept = (): void => {
          if (settled) return
          settled = true
          clearTimeout(probation)
          sock.removeListener('data', accept)
          sock.removeListener('close', onProbationEnd)
          sock.removeListener('error', onProbationEnd)
          sock.on('close', () => this.closeCb('connection closed'))
          sock.on('error', (e) => this.closeCb(e.message))
          resolve()
          // After the caller, not before it: connect() emits `connected` on the tick this
          // resolve releases, and the greeting has to arrive at an app that has been told
          // there is a connection — which is the order it arrived in before there was a
          // probation to hold it back.
          setImmediate(() => held.forEach((c) => this.dataCb(c)))
        }

        // Dropped while on probation: not a connection, and saying so is the whole point.
        // Reported as a refusal rather than as a connection that failed later, because the
        // remedy is different — this board is reachable, it is holding an older session.
        const onProbationEnd = (): void => {
          if (settled) return
          settled = true
          clearTimeout(probation)
          sock.destroy()
          this.socket = null
          reject(
            new Error(
              `${BUSY_SESSION}: the board at ${this.host}:${this.port} accepted the connection and dropped it immediately — it is still holding an earlier telnet session`
            )
          )
        }
        sock.once('close', onProbationEnd)
        sock.once('error', onProbationEnd)

        // A board that speaks has already proved itself; no reason to sit out the rest.
        const probation = setTimeout(accept, SETTLE_MS)
        sock.once('data', accept)
      })
    })
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.socket) return resolve()
      this.socket.end(() => {
        this.socket?.destroy()
        this.socket = null
        resolve()
      })
    })
  }

  write(data: Buffer | string): void {
    this.socket?.write(data)
  }

  get isOpen(): boolean {
    return !!this.socket && !this.socket.destroyed
  }

  onData(cb: (chunk: Buffer) => void): void {
    this.dataCb = cb
  }

  onClose(cb: (reason?: string) => void): void {
    // 'close' and 'error' both arrive when a peer resets the socket, and both used to be
    // reported: every one of those 503 drops was logged, and emitted upward, twice.
    let fired = false
    this.closeCb = (reason?: string) => {
      if (fired) return
      fired = true
      cb(reason)
    }
  }
}
