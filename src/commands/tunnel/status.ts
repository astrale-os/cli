import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { resolveTunnelAdapter } from '../../adapters/tunnel'
import { fatal, log } from '../../lib/log'
import { findTunnel, readTunnels, type TunnelEntry } from '../../lib/tunnels'

async function probe(entry: TunnelEntry): Promise<{ status: string; dnsError: string | null }> {
  const adapter = resolveTunnelAdapter(entry.adapter)
  const [status, dnsError] = await Promise.all([
    adapter.status(entry.id),
    adapter.dnsPreflight(entry.hostname).then(
      () => null,
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    ),
  ])
  return { status, dnsError }
}

export default {
  name: 'status',
  description: 'Show tunnel status + DNS preflight',
  arguments: [{ name: 'name', description: 'Tunnel name or id', required: false }],
  action: async (name?: string) => {
    try {
      const store = await readTunnels()
      let entries: TunnelEntry[]
      if (name) {
        const match = findTunnel(store, name)
        entries = match ? [match] : []
      } else {
        entries = Object.values(store.tunnels)
      }

      if (entries.length === 0) {
        log.dim(name ? `  Tunnel "${name}" not registered.` : '  No tunnels registered.')
        return
      }

      // Probe in parallel; print in registry order so output is stable.
      const probes = await Promise.all(entries.map(probe))

      entries.forEach((entry, i) => {
        const { status, dnsError } = probes[i]!
        console.log(`${chalk.bold(entry.name)} (${entry.id})`)
        log.dim(`  hostname: ${entry.hostname}`)
        log.dim(`  status:   ${status}`)
        if (entry.boundInstance) log.dim(`  bound to: ${entry.boundInstance}`)
        if (entry.ingress.length === 0) {
          log.dim(`  ingress:  none — all requests return 404`)
        } else {
          log.dim(
            `  ingress:  ${entry.ingress.length} rule(s) — list via \`astrale tunnel ingress list ${entry.name}\``,
          )
        }
        if (dnsError) log.warn(`  ${dnsError}`)
        else log.success('  DNS resolves')
      })
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
