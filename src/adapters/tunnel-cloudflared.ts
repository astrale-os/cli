import { createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as yamlParse } from 'yaml'

import type {
  ImportResult,
  IngressRule,
  TunnelAdapter,
  TunnelDescriptor,
  TunnelRunSpec,
  TunnelStatus,
} from '../ports/tunnel'

import { TunnelUnsupportedConfigError } from '../errors'
import {
  hasCloudflared,
  isCloudflaredRunningFor,
  preflightDns,
  runCloudflared,
  spawnCloudflared,
} from '../lib/cloudflared'
import { writeTunnelConfig } from '../lib/cloudflared-config'
import { fileExists } from '../lib/keys'
import { log } from '../lib/log'
import {
  ensureTunnelsDir,
  isPidAlive,
  logPath,
  readPidFile,
  removePidFile,
  writePidFile,
} from '../lib/tunnel-process'
import { isHttpUrl } from '../lib/validation'

export const ADAPTER_NAME = 'cloudflared'

/**
 * Token-auth tunnels (TUNNEL_TOKEN env) don't have a `.json` — callers
 * must tolerate the file being absent.
 */
function defaultCredentialsPath(id: string): string {
  return join(homedir(), '.cloudflared', `${id}.json`)
}

/**
 * Spawn args for `cloudflared`. The credentials-file is written INTO the
 * rendered config, so the only CLI args are `tunnel --config <path> run <id>`.
 * `isCloudflaredRunningFor`'s pgrep pattern (`tunnel.*run <id>`) matches this.
 */
export function buildRunArgs(id: string, configPath: string): string[] {
  return ['tunnel', '--config', configPath, 'run', id]
}

type CfTunnelListItem = { id: string; name: string }

function parseCreateStdout(stdout: string, name: string): { id: string } {
  // `cloudflared tunnel create <name>` prints lines like:
  //   Created tunnel <name> with id <uuid>
  const match = stdout.match(/with id\s+([0-9a-fA-F-]{8,})/)
  if (!match) throw new Error(`Could not parse tunnel id from cloudflared output for "${name}"`)
  return { id: match[1]! }
}

function listCloudflaredTunnels(): CfTunnelListItem[] {
  const r = runCloudflared(['tunnel', 'list', '--output', 'json'])
  if (r.status !== 0) {
    throw new Error(`cloudflared tunnel list failed: ${r.stderr || r.stdout}`)
  }
  try {
    return JSON.parse(r.stdout) as CfTunnelListItem[]
  } catch {
    throw new Error('cloudflared tunnel list returned non-JSON output')
  }
}

/**
 * Parse a `~/.cloudflared/config.yml` body into neutral http(s) ingress
 * rules. Catch-all entries (no hostname) are skipped — the renderer always
 * appends one. **Refuses** the whole import (`TunnelUnsupportedConfigError`)
 * if the config carries anything astrale's neutral model can't express —
 * non-http(s) services, per-rule or top-level `originRequest`, or
 * `warp-routing` — since those would otherwise be dropped on the next
 * regenerated start. Exported for testing.
 */
export function parseCloudflaredIngress(name: string, raw: string): IngressRule[] {
  let doc: unknown
  try {
    doc = yamlParse(raw)
  } catch {
    return []
  }
  if (!doc || typeof doc !== 'object') return []
  const top = doc as Record<string, unknown>

  const rules: IngressRule[] = []
  const reasons: string[] = []

  // Top-level options astrale's neutral model can't carry → refuse the whole
  // import rather than silently drop them when the config is regenerated.
  if ('originRequest' in top) {
    reasons.push('global originRequest options astrale does not manage')
  }
  const warp = top['warp-routing']
  if (warp && typeof warp === 'object' && (warp as { enabled?: unknown }).enabled) {
    reasons.push('warp-routing is enabled — astrale does not manage private-network routing')
  }

  const ingress = top.ingress
  if (Array.isArray(ingress)) {
    for (const entry of ingress) {
      if (!entry || typeof entry !== 'object') continue
      const hostname = (entry as { hostname?: unknown }).hostname
      const service = (entry as { service?: unknown }).service
      if (typeof hostname !== 'string' || hostname.length === 0) continue
      if (typeof service !== 'string' || service.length === 0) continue
      if (!isHttpUrl(service)) {
        reasons.push(`${hostname} → ${service} (only http(s) services are supported)`)
        continue
      }
      if ('originRequest' in (entry as Record<string, unknown>)) {
        reasons.push(`${hostname} carries originRequest options astrale does not manage`)
        continue
      }
      const path = (entry as { path?: unknown }).path
      rules.push({
        hostname,
        service,
        ...(typeof path === 'string' && path.length > 0 ? { path } : {}),
      })
    }
  }
  if (reasons.length > 0) throw new TunnelUnsupportedConfigError(name, reasons)
  return rules
}

async function readCloudflaredIngress(name: string): Promise<IngressRule[]> {
  const path = join(homedir(), '.cloudflared', 'config.yml')
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    return [] // no config.yml → nothing to import
  }
  return parseCloudflaredIngress(name, raw)
}

/** First concrete (non-wildcard) hostname — the registry's primary `hostname`. */
export function firstConcreteHostname(rules: IngressRule[]): string | undefined {
  return rules.find((r) => !r.hostname.startsWith('*'))?.hostname
}

export const cloudflaredAdapter: TunnelAdapter = {
  name: ADAPTER_NAME,

  async isAvailable() {
    return hasCloudflared()
  },

  async create({ name, hostname, routeDns }): Promise<TunnelDescriptor> {
    const r = runCloudflared(['tunnel', 'create', name])
    if (r.status !== 0) {
      throw new Error(`cloudflared tunnel create failed: ${r.stderr || r.stdout}`)
    }
    const { id } = parseCreateStdout(r.stdout, name)
    if (routeDns) {
      const dns = runCloudflared(['tunnel', 'route', 'dns', id, hostname])
      if (dns.status !== 0) {
        log.warn(`route dns failed: ${dns.stderr || dns.stdout}`)
      } else {
        log.success(`DNS route registered for ${hostname}`)
      }
    }
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
    // Best-effort for status display — any failure degrades to an empty list.
    // `importExisting` uses the throwing `listCloudflaredTunnels` directly.
    try {
      return listCloudflaredTunnels().map((it) => ({
        id: it.id,
        name: it.name,
        hostname: '',
        adapter: ADAPTER_NAME,
      }))
    } catch {
      return []
    }
  },

  async start(spec: TunnelRunSpec): Promise<{ pid: number }> {
    await ensureTunnelsDir()
    const credsPath = defaultCredentialsPath(spec.id)
    const credentialsFile = (await fileExists(credsPath)) ? credsPath : null
    if (!credentialsFile) {
      log.warn(
        `No cloudflared credentials at ${credsPath} — relying on TUNNEL_TOKEN env or ~/.cloudflared/config.yml fallback.`,
      )
    }
    if (spec.ingress.length === 0) {
      log.warn(
        `Tunnel ${spec.id} has no ingress — every request will return 404. Add routes via \`astrale tunnel ingress add\`.`,
      )
    }

    const configPath = await writeTunnelConfig(spec, credentialsFile)
    const args = buildRunArgs(spec.id, configPath)

    const logStream = createWriteStream(logPath(spec.id), { flags: 'a' })
    const pid = spawnCloudflared(args, logStream)
    if (pid < 0) throw new Error('Failed to spawn cloudflared')
    await writePidFile(spec.id, pid)
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
    // Best-effort server-side cleanup of stale tunnel connections, but only
    // when the cloudflared binary is present (skips silently otherwise).
    if (hasCloudflared()) {
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
    if (pid && pid > 0 && isPidAlive(pid)) return 'running'
    return 'stopped'
  },

  async importExisting(name: string): Promise<ImportResult> {
    const tunnels = listCloudflaredTunnels()
    const match = tunnels.find((t) => t.name === name)
    if (!match) {
      const known = tunnels.map((t) => t.name).join(', ') || '(none)'
      throw new Error(
        `cloudflared has no tunnel named "${name}". Known tunnels: ${known}. ` +
          `To create a new one: astrale tunnel setup ${name}`,
      )
    }
    const ingress = await readCloudflaredIngress(name)
    return {
      descriptor: { id: match.id, name: match.name, hostname: '', adapter: ADAPTER_NAME },
      ingress,
      suggestedHostname: firstConcreteHostname(ingress),
    }
  },
}
