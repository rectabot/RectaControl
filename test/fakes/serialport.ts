/** Stands in for the `serialport` package, so the port-picking rules and the open
 *  probation can be tested on a PC with no board attached — which is the whole point,
 *  since the bug they exist for is about ports that have nothing behind them.
 *
 *  Only what src/main/transport/serial.ts actually uses is implemented.
 */
import { EventEmitter } from 'node:events'

export interface FakePortInfo {
  path: string
  manufacturer?: string
  vendorId?: string
  productId?: string
  pnpId?: string
}

/** How an opened port behaves: `answers` replies to anything written (a board),
 *  `silent` opens and never says a word (an empty chipset UART), `refuse` will not
 *  open at all (someone else holds it). */
export type Behaviour = 'answers' | 'silent' | 'refuse'

let ports: FakePortInfo[] = []
let behaviour: Record<string, Behaviour> = {}

/** Paths an open succeeded on, and paths that were closed again — the second is how
 *  a test sees whether a rejected port was released or left in our hand. */
export const opened: string[] = []
export const closed: string[] = []

export function setPorts(list: FakePortInfo[], how: Record<string, Behaviour> = {}): void {
  ports = list
  behaviour = how
  opened.length = 0
  closed.length = 0
}

export class SerialPort extends EventEmitter {
  isOpen = false
  readonly path: string

  constructor(opts: { path: string; baudRate: number }, cb: (err: Error | null) => void) {
    super()
    this.path = opts.path
    setImmediate(() => {
      if ((behaviour[this.path] ?? 'silent') === 'refuse') {
        cb(new Error(`Opening ${this.path}: Access denied`))
        return
      }
      this.isOpen = true
      opened.push(this.path)
      cb(null)
    })
  }

  write(_data: Buffer | string): boolean {
    if (this.isOpen && (behaviour[this.path] ?? 'silent') === 'answers')
      setImmediate(() => this.emit('data', Buffer.from('<Idle|MPos:0.000,0.000,0.000|FS:0,0>\n')))
    return true
  }

  close(cb?: (err: Error | null) => void): void {
    this.isOpen = false
    closed.push(this.path)
    this.emit('close')
    cb?.(null)
  }

  static list(): Promise<FakePortInfo[]> {
    return Promise.resolve(ports)
  }
}
