import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { findFreePort } from '../port'
import { withViewPortAllocationLock } from '../view/port-allocation'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'astrale-view-port-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function listen(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => resolve(server))
  })
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

describe('view port allocation', () => {
  test('never overlaps concurrent allocation critical sections', async () => {
    const lockPath = join(tmp, 'ports.lock')
    let active = 0
    let maxActive = 0

    const contender = () =>
      withViewPortAllocationLock(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await Bun.sleep(40)
        active--
      }, lockPath)

    await Promise.all([contender(), contender()])

    // Without the view-specific lock both contenders enter before either
    // delay completes, making this 2 and recreating the probe/bind window.
    expect(maxActive).toBe(1)
  })

  test('serializes concurrent probe-then-listen allocations', async () => {
    const base = await findFreePort(48000, 200)
    expect(base).not.toBeNull()
    if (base === null) throw new Error('test port window exhausted')
    const lockPath = join(tmp, 'ports.lock')

    const allocate = () =>
      withViewPortAllocationLock(async () => {
        const port = await findFreePort(base, 4)
        if (port === null) throw new Error('test port window exhausted')

        // Widen the exact pre-fix race: both callers would finish the advisory
        // probe before either one binds, then one would fail with EADDRINUSE.
        await Bun.sleep(40)
        const server = await listen(port)
        return { port, server }
      }, lockPath)

    const allocations = await Promise.all([allocate(), allocate()])
    try {
      const ports = allocations.map(({ port }) => port).sort((a, b) => a - b)
      expect(ports[0]).toBe(base)
      expect(ports[1]).toBeGreaterThan(base)
    } finally {
      await Promise.all(allocations.map(({ server }) => close(server)))
    }
  })
})
