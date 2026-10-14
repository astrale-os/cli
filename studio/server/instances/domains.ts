import type { InstanceDomain, InstanceDomains } from '../../shared/contracts/workspace'

import { runStudioCliJson } from '../cli'
import { asJsonRecord, decodeEach } from '../json'

/** The Domains installed on one instance, read through `astrale domain list -i <name>`. */
export async function listInstanceDomains(name: string): Promise<InstanceDomains> {
  const result = await runStudioCliJson(['domain', 'list', '--instance', name], decodeInstalled)
  if (result.ok && result.data) return { ok: true, domains: result.data }
  return { ok: false, domains: [], error: result.detail || 'Could not read the installed Domains' }
}

export function decodeInstalled(value: unknown): InstanceDomain[] | undefined {
  const list = asJsonRecord(value)
  if (list?.format !== 'astrale.installed-list') return undefined
  return decodeEach(list.domains, (item) => {
    const domain = asJsonRecord(item)
    if (typeof domain?.origin !== 'string' || typeof domain.name !== 'string') return undefined
    return {
      origin: domain.origin,
      name: domain.name,
      ...(typeof domain.version === 'string' ? { version: domain.version } : {}),
      ...(typeof domain.url === 'string' ? { url: domain.url } : {}),
      ...(typeof domain.available === 'string' ? { available: domain.available } : {}),
    }
  })
}
