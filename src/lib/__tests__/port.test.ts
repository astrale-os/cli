import { describe, expect, it } from 'bun:test'
import net from 'node:net'

import { findFreePort, portFree } from '../port'

function listen(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen({ port, host: '127.0.0.1', exclusive: true }, () => resolve(s))
  })
}
const close = (s: net.Server) => new Promise<void>((r) => s.close(() => r()))

describe('port', () => {
  it('portFree: true for an unbound port, false once it is bound', async () => {
    const p = await findFreePort(48000, 200)
    expect(p).not.toBeNull()
    expect(await portFree(p as number)).toBe(true)
    const srv = await listen(p as number)
    try {
      expect(await portFree(p as number)).toBe(false)
    } finally {
      await close(srv)
    }
  })

  it('findFreePort: skips a busy port and returns a later free one', async () => {
    const base = await findFreePort(48000, 200)
    expect(base).not.toBeNull()
    const srv = await listen(base as number)
    try {
      const next = await findFreePort(base as number, 10)
      expect(next).not.toBeNull()
      expect(next as number).toBeGreaterThan(base as number)
    } finally {
      await close(srv)
    }
  })

  it('findFreePort: returns null when the band is empty (span 0)', async () => {
    expect(await findFreePort(48000, 0)).toBeNull()
  })
})
