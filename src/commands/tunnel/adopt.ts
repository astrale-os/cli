import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { CommandDefinition } from '../../command'

import { hasCloudflared, runCloudflared } from '../../lib/cloudflared'
import { fatal, log } from '../../lib/log'
import { addTunnel, readTunnels } from '../../lib/tunnels'

type CfTunnelListItem = { id: string; name: string }

/**
 * Parse the ingress hostnames out of a `~/.cloudflared/config.yml` body.
 *
 * Minimal YAML parser — we only care about `hostname:` lines under
 * `ingress:`, and we skip wildcard entries (`*.foo`). cloudflared
 * configs rarely nest anything exotic, so a line-based pass is safer
 * than pulling in a full YAML dep just for one command.
 *
 * Exported for testing.
 */
export function parseCloudflaredIngress(raw: string): string[] {
  const hostnames: string[] = []
  let inIngress = false
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/#.*$/, '') // strip comments
    if (/^ingress:\s*$/.test(line)) {
      inIngress = true
      continue
    }
    if (inIngress && /^[a-zA-Z]/.test(line)) {
      // new top-level key — leave ingress block
      inIngress = false
    }
    if (!inIngress) continue
    const m = /^\s*-?\s*hostname:\s*["']?([^"'\s]+)["']?\s*$/.exec(line)
    if (m && m[1] && !m[1].startsWith('*')) {
      hostnames.push(m[1])
    }
  }
  return hostnames
}

async function readCloudflaredIngress(): Promise<string[]> {
  const path = join(homedir(), '.cloudflared', 'config.yml')
  try {
    const raw = await readFile(path, 'utf-8')
    return parseCloudflaredIngress(raw)
  } catch {
    return []
  }
}

async function listCloudflaredTunnels(): Promise<CfTunnelListItem[]> {
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

export default {
  name: 'adopt',
  description:
    'Register an existing cloudflared tunnel (created outside the CLI) in the astrale registry',
  arguments: [{ name: 'name', description: 'Existing cloudflared tunnel name', required: true }],
  options: [
    {
      flags: '--hostname <host>',
      description:
        'Hostname to bind. Required if `~/.cloudflared/config.yml` contains multiple ingress entries',
    },
  ],
  action: async (name: string, opts: { hostname?: string }) => {
    try {
      if (!hasCloudflared()) {
        log.dim(
          '  install: `brew install cloudflared` (macOS) or https://github.com/cloudflare/cloudflared',
        )
        fatal(new Error('cloudflared not found on PATH'))
      }

      const existing = await readTunnels()
      if (existing.tunnels[name]) {
        fatal(
          new Error(
            `Tunnel "${name}" is already registered with astrale. Use \`astrale tunnel list\` to inspect.`,
          ),
        )
      }

      const cfTunnels = await listCloudflaredTunnels()
      const match = cfTunnels.find((t) => t.name === name)
      if (!match) {
        const known = cfTunnels.map((t) => t.name).join(', ') || '(none)'
        fatal(
          new Error(
            `cloudflared has no tunnel named "${name}". Known tunnels: ${known}. ` +
              `To create a new one: astrale tunnel setup ${name}`,
          ),
        )
      }

      let hostname = opts.hostname
      if (!hostname) {
        const ingress = await readCloudflaredIngress()
        if (ingress.length === 0) {
          fatal(
            new Error(
              `Cannot infer hostname: ~/.cloudflared/config.yml has no ingress. ` +
                `Pass --hostname <host> explicitly.`,
            ),
          )
        }
        if (ingress.length > 1) {
          fatal(
            new Error(
              `Multiple ingress hostnames found in ~/.cloudflared/config.yml (${ingress.join(', ')}). ` +
                `Pass --hostname <host> to pick one.`,
            ),
          )
        }
        hostname = ingress[0]!
      }

      await addTunnel({
        id: match!.id,
        name: match!.name,
        adapter: 'cloudflared',
        hostname,
        createdAt: new Date().toISOString(),
      })

      log.success(`Adopted tunnel "${name}" (id=${match!.id})`)
      log.dim(`  hostname: ${hostname}`)
      log.dim(`  Next: astrale tunnel start ${name}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
