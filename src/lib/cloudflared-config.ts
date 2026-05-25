import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { stringify as yamlStringify } from 'yaml'

import type { TunnelRunSpec } from '../ports/tunnel'

import { TUNNELS_DIR } from './paths'

/**
 * Cloudflared requires a catch-all entry as the last ingress rule, else it
 * refuses to start. We always append this one so callers never have to.
 */
export const CLOUDFLARED_CATCH_ALL_SERVICE = 'http_status:404'

export function tunnelConfigPath(id: string): string {
  return join(TUNNELS_DIR, `${id}.yml`)
}

/**
 * Render a cloudflared config.yml from a registry entry. Pure (no I/O).
 *
 * `protocol: http2` is forced over the QUIC/UDP default because some
 * networks (corporate firewalls, mobile carriers, certain NATs) drop UDP
 * after the initial handshake, producing `failed to dial to edge with quic:
 * timeout` followed by CF error 1033. HTTP/2 over TCP stays on the same
 * outbound port (7844) and is reliable wherever HTTPS works.
 */
export function renderTunnelConfig(entry: TunnelRunSpec, credentialsFile: string | null): string {
  const doc: Record<string, unknown> = { tunnel: entry.id }
  if (credentialsFile) doc['credentials-file'] = credentialsFile
  doc.protocol = 'http2'
  doc.ingress = [
    ...entry.ingress.map((rule) => ({
      hostname: rule.hostname,
      service: rule.service,
      ...(rule.path ? { path: rule.path } : {}),
    })),
    { service: CLOUDFLARED_CATCH_ALL_SERVICE },
  ]
  return yamlStringify(doc)
}

export async function writeTunnelConfig(
  entry: TunnelRunSpec,
  credentialsFile: string | null,
): Promise<string> {
  const out = tunnelConfigPath(entry.id)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, renderTunnelConfig(entry, credentialsFile))
  return out
}
