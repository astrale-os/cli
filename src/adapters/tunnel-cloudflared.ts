import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { TunnelAdapter, TunnelDescriptor, TunnelStatus } from '../ports/tunnel'

import {
  hasCloudflared,
  isCloudflaredRunningFor,
  preflightDns,
  runCloudflared,
  spawnCloudflared,
} from '../lib/cloudflared'
import { TUNNELS_DIR } from '../lib/paths'

const ADAPTER_NAME = 'cloudflared'

async function ensureDir(): Promise<void> {
  await mkdir(TUNNELS_DIR, { recursive: true })
}

function pidPath(id: string): string {
  return join(TUNNELS_DIR, `${id}.pid`)
}

function logPath(id: string): string {
  return join(TUNNELS_DIR, `${id}.log`)
}

async function writePidFile(id: string, pid: number): Promise<void> {
  await ensureDir()
  await writeFile(pidPath(id), String(pid))
}

async function readPidFile(id: string): Promise<number | null> {
  try {
    const raw = await readFile(pidPath(id), 'utf-8')
    const pid = Number.parseInt(raw.trim(), 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

async function removePidFile(id: string): Promise<void> {
  try {
    await unlink(pidPath(id))
  } catch {
    /* ignore */
  }
}

/**
 * Best-effort SIGTERM to every cloudflared pid recorded under TUNNELS_DIR.
 * Used by `astrale reset --hard`. Tolerates missing dir, missing pids, and
 * dead processes. Returns the number of pids signaled (i.e. live processes
 * we asked to exit).
 */
export async function stopAllTunnels(): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(TUNNELS_DIR)
  } catch {
    return 0
  }
  let signaled = 0
  for (const entry of entries) {
    if (!entry.endsWith('.pid')) continue
    let raw: string
    try {
      raw = await readFile(join(TUNNELS_DIR, entry), 'utf-8')
    } catch {
      continue
    }
    const pid = Number.parseInt(raw.trim(), 10)
    if (!Number.isFinite(pid) || pid <= 0) continue
    try {
      process.kill(pid, 'SIGTERM')
      signaled++
    } catch {
      /* already dead or not ours */
    }
  }
  return signaled
}

type CfTunnelListItem = { id: string; name: string }

function parseCreateStdout(stdout: string, name: string): { id: string } {
  // `cloudflared tunnel create <name>` prints lines like:
  //   Created tunnel <name> with id <uuid>
  const match = stdout.match(/with id\s+([0-9a-fA-F-]{8,})/)
  if (!match) throw new Error(`Could not parse tunnel id from cloudflared output for "${name}"`)
  return { id: match[1]! }
}

export const cloudflaredAdapter: TunnelAdapter = {
  name: ADAPTER_NAME,

  async isAvailable() {
    return hasCloudflared()
  },

  async create({ name, hostname }): Promise<TunnelDescriptor> {
    const r = runCloudflared(['tunnel', 'create', name])
    if (r.status !== 0) {
      throw new Error(`cloudflared tunnel create failed: ${r.stderr || r.stdout}`)
    }
    const { id } = parseCreateStdout(r.stdout, name)
    return { id, name, hostname, adapter: ADAPTER_NAME }
  },

  async delete(id: string): Promise<void> {
    const r = runCloudflared(['tunnel', 'delete', '-f', id])
    if (r.status !== 0) {
      throw new Error(`cloudflared tunnel delete failed: ${r.stderr || r.stdout}`)
    }
    await removePidFile(id)
  },

  async list(): Promise<TunnelDescriptor[]> {
    const r = runCloudflared(['tunnel', 'list', '--output', 'json'])
    if (r.status !== 0) return []
    try {
      const items = JSON.parse(r.stdout) as CfTunnelListItem[]
      return items.map((it) => ({
        id: it.id,
        name: it.name,
        hostname: '',
        adapter: ADAPTER_NAME,
      }))
    } catch {
      return []
    }
  },

  async start(id: string): Promise<{ pid: number }> {
    await ensureDir()
    const logStream = createWriteStream(logPath(id), { flags: 'a' })
    const pid = spawnCloudflared(['tunnel', 'run', id], logStream)
    if (pid < 0) throw new Error('Failed to spawn cloudflared')
    await writePidFile(id, pid)
    return { pid }
  },

  async stop(id: string): Promise<void> {
    const pid = await readPidFile(id)
    if (pid && pid > 0) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        /* already dead */
      }
    }
    // Fallback: pkill pattern matches anything launched outside the CLI.
    const r = runCloudflared(['tunnel', '--help'])
    if (r.status === 0) {
      runCloudflared(['tunnel', 'cleanup', id])
    }
    await removePidFile(id)
  },

  async dnsPreflight(hostname: string): Promise<void> {
    return preflightDns(hostname)
  },

  async status(id: string): Promise<TunnelStatus> {
    if (isCloudflaredRunningFor(id)) return 'running'
    const pid = await readPidFile(id)
    if (pid && pid > 0) {
      try {
        process.kill(pid, 0)
        return 'running'
      } catch {
        return 'stopped'
      }
    }
    return 'stopped'
  },
}
