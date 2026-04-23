import { execSync, spawn, spawnSync } from 'node:child_process'
import { lookup } from 'node:dns/promises'

import { TunnelDnsUnresolvedError } from '../errors'

/** Returns true if `cloudflared` is on PATH. */
export function hasCloudflared(): boolean {
  try {
    const r = spawnSync('cloudflared', ['--version'], { stdio: 'ignore' })
    return r.status === 0
  } catch {
    return false
  }
}

/** Best-effort pgrep — matches the tunnel by its id in the command line. */
export function isCloudflaredRunningFor(tunnelId: string): boolean {
  try {
    const out = execSync(`pgrep -laf 'cloudflared tunnel run ${tunnelId}'`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim().length > 0
  } catch {
    return false
  }
}

export async function preflightDns(hostname: string): Promise<void> {
  try {
    await lookup(hostname)
  } catch {
    throw new TunnelDnsUnresolvedError(hostname)
  }
}

/** Spawn cloudflared detached; returns the child PID. */
export function spawnCloudflared(args: string[], logStream: NodeJS.WritableStream): number {
  const child = spawn('cloudflared', args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.pipe(logStream)
  child.stderr?.pipe(logStream)
  child.unref()
  return child.pid ?? -1
}

export function runCloudflared(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('cloudflared', args, { encoding: 'utf-8' })
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}
