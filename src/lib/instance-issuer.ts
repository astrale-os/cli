/**
 * Resolve the audience (= kernel issuer) to stamp on credentials for a
 * target kernel instance. The JWT's `aud` must match the target kernel's
 * `kernelIssuer` exactly — transport URL is irrelevant.
 *
 * The manager's own issuer lives in `config.issuer`. Local-child issuers
 * are manager-side source of truth (returned by `KernelInstance/list` via
 * the TTL-cached `resolveInstance`). Bookmarks carry their own issuer in
 * the registry entry (manager has no visibility into remotes).
 *
 * Thin wrapper over `resolveInstance` — no separate cache, no write-back.
 */

import type { AstraleConfig } from './config'

import { readInstances, resolveInstance, resolveInstanceKey } from './instance'

type AudienceOpts = {
  url?: string
  instance?: string
}

export async function resolveAudience(
  opts: AudienceOpts,
  config: AstraleConfig,
  targetUrl: string,
): Promise<string> {
  // Ad-hoc `--url` with no `--instance` — user is pointing at an unknown
  // kernel. Best we can do is stamp the URL itself as audience.
  if (opts.url && !opts.instance) {
    return targetUrl
  }

  const identifier = opts.instance ?? (await readInstances(config)).active
  // `resolveInstance` throws `MANAGER_UNREACHABLE` if it can neither hit
  // the manager nor fall back to cache. Don't block signing on that —
  // degrade to the fallback URL (the child's default issuer when no
  // tunnel was registered).
  try {
    const resolved = await resolveInstance(identifier, config)
    return resolved.issuer ?? resolved.url
  } catch {
    const store = await readInstances(config)
    const slug = resolveInstanceKey(store, identifier) ?? identifier
    if (slug === 'manager' || store.instances[slug]?.kind === 'manager') {
      return config.issuer
    }
    return `http://localhost:${config.managerPort}/${slug}`
  }
}
