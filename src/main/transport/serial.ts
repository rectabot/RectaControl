/** USB CDC transport via the serialport package. */

import { SerialPort } from 'serialport'
import type { Transport } from './index'
import type { SerialPortInfo } from '@shared/types'

export async function listPorts(): Promise<SerialPortInfo[]> {
  const ports = await SerialPort.list()
  return ports.map((p) => ({ path: p.path, manufacturer: p.manufacturer }))
}

export class SerialTransport implements Transport {
  private port: SerialPort | null = null
  private dataCb: (chunk: Buffer) => void = () => {}
  private closeCb: (reason?: string) => void = () => {}

  constructor(
    private path: string,
    private baud = 115200
  ) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port = new SerialPort({ path: this.path, baudRate: this.baud }, (err) => {
        if (err) {
          this.port = null
          reject(err)
          return
        }
        resolve()
      })
      this.port.on('data', (chunk: Buffer) => this.dataCb(chunk))
      this.port.on('close', () => this.closeCb('port closed'))
      this.port.on('error', (e) => this.closeCb(e.message))
    })
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port) return resolve()
      this.port.close(() => {
        this.port = null
        resolve()
      })
    })
  }

  write(data: Buffer | string): void {
    this.port?.write(data)
  }

  get isOpen(): boolean {
    return !!this.port?.isOpen
  }

  onData(cb: (chunk: Buffer) => void): void {
    this.dataCb = cb
  }

  onClose(cb: (reason?: string) => void): void {
    this.closeCb = cb
  }
}
