/** Ethernet transport — raw TCP to the grblHAL telnet server (W5500, port 23). */

import net from 'node:net'
import type { Transport } from './index'

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
        sock.on('data', (chunk: Buffer) => this.dataCb(chunk))
        sock.on('close', () => this.closeCb('connection closed'))
        sock.on('error', (e) => this.closeCb(e.message))
        resolve()
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
    this.closeCb = cb
  }
}
