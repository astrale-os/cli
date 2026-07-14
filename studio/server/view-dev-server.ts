import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

import type { ViewDevServerStatus } from '../shared/types'

import { resolveClientPackage } from './client-package'

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000
const DEFAULT_START_TIMEOUT_MS = 20_000
const DEFAULT_FAILURE_RETRY_MS = 10_000
const STOP_GRACE_MS = 2_000
const MAX_OUTPUT = 8_000

interface DevServerRecord {
  root: string
  port: number
  url: string
  child: ChildProcess
  output: string
  startedAt: string
  lastUsedAt: number
  ready: boolean
  idleTimer?: ReturnType<typeof setTimeout>
  stopping: boolean
  stopPromise?: Promise<void>
}

interface FailedStart {
  status: Extract<ViewDevServerStatus, { status: 'failed' }>
  retryAt: number
}

interface ManagerOptions {
  idleTimeoutMs?: number
  startTimeoutMs?: number
  failureRetryMs?: number
}

/**
 * Owns one lazy Vite process per domain. Ports are leased from the OS rather
 * than inferred from project config, so independently opened domains cannot
 * collide. Runtime probes from an open modal act as the lease heartbeat; once
 * they stop, the process group is retired after the idle window.
 */
export class ViewDevServerManager {
  private readonly idleTimeoutMs: number
  private readonly startTimeoutMs: number
  private readonly failureRetryMs: number
  private readonly servers = new Map<string, DevServerRecord>()
  private readonly starts = new Map<string, Promise<ViewDevServerStatus>>()
  private readonly failures = new Map<string, FailedStart>()
  private readonly reservedPorts = new Set<number>()
  private shuttingDown = false

  constructor(options: ManagerOptions = {}) {
    this.idleTimeoutMs =
      options.idleTimeoutMs === undefined
        ? Math.max(
            30_000,
            positiveMs(process.env.DOMAIN_STUDIO_VIEW_IDLE_MS, DEFAULT_IDLE_TIMEOUT_MS),
          )
        : positiveMs(options.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS)
    this.startTimeoutMs = positiveMs(options.startTimeoutMs, DEFAULT_START_TIMEOUT_MS)
    this.failureRetryMs = positiveMs(options.failureRetryMs, DEFAULT_FAILURE_RETRY_MS)
  }

  async ensure(root: string, force = false): Promise<ViewDevServerStatus> {
    const key = resolve(root)
    if (this.shuttingDown) {
      return { status: 'failed', reason: 'Domain Studio is shutting down.' }
    }

    const pending = this.starts.get(key)
    if (pending) return pending

    const running = this.servers.get(key)
    if (running && childAlive(running.child)) {
      this.touch(running)
      return this.snapshot(running)
    }
    if (running) await this.stopRecord(running)

    const client = await resolveClientPackage(key, force)
    if (client.status === 'unavailable') return client

    // Concurrent cold requests share package discovery. Re-check after that
    // await so only one of them gets to spawn the Vite process.
    const pendingAfterProbe = this.starts.get(key)
    if (pendingAfterProbe) return pendingAfterProbe
    const runningAfterProbe = this.servers.get(key)
    if (runningAfterProbe && childAlive(runningAfterProbe.child)) {
      this.touch(runningAfterProbe)
      return this.snapshot(runningAfterProbe)
    }

    const failed = this.failures.get(key)
    if (!force && failed && Date.now() < failed.retryAt) return failed.status
    this.failures.delete(key)

    const started = this.start(key, client.packageDir).catch((error: unknown) => {
      const status: Extract<ViewDevServerStatus, { status: 'failed' }> = {
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      }
      this.failures.set(key, { status, retryAt: Date.now() + this.failureRetryMs })
      return status
    })
    this.starts.set(key, started)
    try {
      return await started
    } finally {
      if (this.starts.get(key) === started) this.starts.delete(key)
    }
  }

  async restart(root: string): Promise<ViewDevServerStatus> {
    const key = resolve(root)
    await this.stop(key)
    this.failures.delete(key)
    return this.ensure(key, true)
  }

  status(root: string): ViewDevServerStatus | null {
    const key = resolve(root)
    const running = this.servers.get(key)
    if (running?.ready && childAlive(running.child)) return this.snapshot(running)
    return this.failures.get(key)?.status ?? null
  }

  async stop(root: string): Promise<void> {
    const key = resolve(root)
    const running = this.servers.get(key)
    if (running) await this.stopRecord(running)
    this.failures.delete(key)
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const pendingStarts = [...this.starts.values()]
    await Promise.all([...this.servers.values()].map((record) => this.stopRecord(record)))
    await Promise.allSettled(pendingStarts)
    await Promise.all([...this.servers.values()].map((record) => this.stopRecord(record)))
    this.failures.clear()
  }

  private async start(root: string, clientDir: string): Promise<ViewDevServerStatus> {
    let lastReason = 'The local frontend server did not become ready.'
    for (let attempt = 0; attempt < 3; attempt++) {
      const port = await this.reservePort()
      const url = `http://127.0.0.1:${port}`
      const child = spawn(
        'pnpm',
        ['run', 'dev:hmr', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
        {
          cwd: clientDir,
          detached: process.platform !== 'win32',
          env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0', NO_UPDATE_NOTIFIER: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      const now = Date.now()
      const record: DevServerRecord = {
        root,
        port,
        url,
        child,
        output: '',
        startedAt: new Date(now).toISOString(),
        lastUsedAt: now,
        ready: false,
        stopping: false,
      }
      this.servers.set(root, record)
      this.capture(record, child.stdout)
      this.capture(record, child.stderr)
      child.once('error', (error) => this.append(record, error.message))
      child.once('exit', () => {
        this.reservedPorts.delete(port)
        if (!record.stopping && this.servers.get(root) === record) this.servers.delete(root)
      })

      if (await waitForHttp(record, this.startTimeoutMs)) {
        record.ready = true
        this.touch(record)
        return this.snapshot(record)
      }

      lastReason = failureReason(record.output)
      const portConflict = /address already in use|eaddrinuse|port \d+ is already in use/i.test(
        record.output,
      )
      await this.stopRecord(record)
      if (!portConflict) break
    }

    const status: Extract<ViewDevServerStatus, { status: 'failed' }> = {
      status: 'failed',
      reason: lastReason,
    }
    this.failures.set(root, { status, retryAt: Date.now() + this.failureRetryMs })
    return status
  }

  private touch(record: DevServerRecord): void {
    record.lastUsedAt = Date.now()
    this.scheduleIdleStop(record, this.idleTimeoutMs)
  }

  private scheduleIdleStop(record: DevServerRecord, delayMs: number): void {
    if (record.idleTimer) clearTimeout(record.idleTimer)
    record.idleTimer = setTimeout(() => {
      const remaining = this.idleTimeoutMs - (Date.now() - record.lastUsedAt)
      if (remaining > 0) {
        this.scheduleIdleStop(record, remaining)
        return
      }
      void this.stopRecord(record)
    }, delayMs)
    record.idleTimer.unref?.()
  }

  private snapshot(record: DevServerRecord): Extract<ViewDevServerStatus, { status: 'running' }> {
    return {
      status: 'running',
      url: record.url,
      port: record.port,
      startedAt: record.startedAt,
      idleTimeoutMs: this.idleTimeoutMs,
    }
  }

  private capture(record: DevServerRecord, stream: NodeJS.ReadableStream | null): void {
    stream?.on('data', (chunk) => this.append(record, String(chunk)))
  }

  private append(record: DevServerRecord, chunk: string): void {
    record.output = `${record.output}${chunk.replace(/\u001b\[[0-9;]*m/g, '')}`.slice(-MAX_OUTPUT)
  }

  private async reservePort(): Promise<number> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const port = await availablePort()
      if (this.reservedPorts.has(port)) continue
      this.reservedPorts.add(port)
      return port
    }
    throw new Error('Could not allocate an available loopback port for the frontend server.')
  }

  private stopRecord(record: DevServerRecord): Promise<void> {
    if (record.stopPromise) return record.stopPromise
    record.stopPromise = this.stopRecordNow(record)
    return record.stopPromise
  }

  private async stopRecordNow(record: DevServerRecord): Promise<void> {
    record.stopping = true
    if (record.idleTimer) clearTimeout(record.idleTimer)
    if (this.servers.get(record.root) === record) this.servers.delete(record.root)
    this.reservedPorts.delete(record.port)
    if (!childAlive(record.child)) return

    signalProcessGroup(record.child, 'SIGTERM')
    if (await waitForExit(record.child, STOP_GRACE_MS)) return
    signalProcessGroup(record.child, 'SIGKILL')
    await waitForExit(record.child, 500)
  }
}

function positiveMs(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function childAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null && child.pid !== undefined
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // Already gone.
    }
  }
}

async function availablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('The operating system did not allocate a TCP port.'))
        return
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)))
    })
  })
}

async function waitForHttp(record: DevServerRecord, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && childAlive(record.child)) {
    try {
      const response = await fetch(record.url, {
        signal: AbortSignal.timeout(600),
        headers: { accept: 'text/html' },
      })
      if (response.status < 500) return true
    } catch {
      // Vite has not bound yet.
    }
    await Bun.sleep(100)
  }
  return false
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (!childAlive(child)) return true
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolveExit(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolveExit(true)
    }
    child.once('exit', onExit)
    if (!childAlive(child)) {
      child.off('exit', onExit)
      clearTimeout(timer)
      resolveExit(true)
    }
  })
}

function failureReason(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const useful = [...lines]
    .reverse()
    .find(
      (line) =>
        /error|failed|not found|missing|cannot|unable|eaddrinuse/i.test(line) &&
        !/^at\s/.test(line),
    )
  if (useful) return useful.slice(0, 600)
  const last = lines.at(-1)
  return (
    'The dev:hmr script did not bind the Studio-assigned port.' +
    (last ? ` Last output: ${last}` : '')
  ).slice(0, 600)
}

export const viewDevServers = new ViewDevServerManager()

export const ensureViewDevServer = (root: string) => viewDevServers.ensure(root)
export const restartViewDevServer = (root: string) => viewDevServers.restart(root)
export const shutdownViewDevServers = () => viewDevServers.shutdown()
