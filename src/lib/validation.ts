import { z } from 'zod'

import { ReservedSlugError } from '../errors'

// Shared validators + schema fragments used by both instance and identity
// registries — kept in a leaf module to avoid circular imports.

const NAME_RE = /^[a-zA-Z0-9_.-]+$/
// §4.7 — URL-safe slug.
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/
// `host` is the reserved slug of the host/manager kernel (SPEC §5.2); `manager` is the legacy name.
const RESERVED_SLUGS = new Set(['manager', 'host'])

export { RESERVED_SLUGS }

export function validateName(name: string, entity: string): void {
  if (!name || !NAME_RE.test(name)) {
    throw new Error(
      `Invalid ${entity.toLowerCase()} name "${name}" — must be non-empty and contain only letters, digits, hyphens, underscores, and dots`,
    )
  }
}

export function validateSlug(slug: string): void {
  if (!slug || !SLUG_RE.test(slug)) {
    throw new Error(`Invalid slug "${slug}" — must match [a-z0-9][a-z0-9-]* (§4.7)`)
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new ReservedSlugError(slug)
  }
}

export function validateUrl(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('not http(s)')
    }
  } catch {
    throw new Error(`Invalid URL "${url}" — expected a valid http:// or https:// URL`)
  }
}

/** Non-throwing predicate form of `validateUrl`. */
export function isHttpUrl(url: string): boolean {
  try {
    validateUrl(url)
    return true
  } catch {
    return false
  }
}

/** `local` = only this machine. `remote` = mirrored via astrale cloud (§2.7). */
export const RegistryModeSchema = z.enum(['local', 'remote'])
export type RegistryMode = z.infer<typeof RegistryModeSchema>
