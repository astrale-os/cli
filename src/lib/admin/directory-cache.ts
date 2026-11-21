import { readFile, unlink } from 'node:fs/promises'
import { z } from 'zod'

import type { DirectoryDependencies, DirectoryReadOptions, InstanceDirectory } from './directory'

import { AstraleError } from '../../errors'
import { getDefault, getIdentity } from '../../identity/registry'
import { atomicWrite } from '../../state/files'
import { paths } from '../../state/paths'
import { readInstanceDirectory } from './directory'

/**
 * The last listing of the instance directory, kept per identity so that a slow or unavailable
 * Admin Worker does not stop `instance list` or a connection by slug. It holds what the directory
 * returned (slugs, URLs, organization names), when, and for which sign-in subject; never a token.
 */

/** A listing this recent serves a slug lookup without asking the directory. */
export const DIRECTORY_FRESH_MS = 5 * 60_000
/** A listing older than this is never served, even when the directory is down. */
export const DIRECTORY_STALE_MAX_MS = 7 * 24 * 60 * 60_000

/** Directory failures the last listing stands in for. A refused or ended sign-in is not one. */
const FALLBACK_CODES = new Set(['DIRECTORY_UNAVAILABLE', 'DIRECTORY_RATE_LIMITED'])

/** Identity names that are safe as one file name. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/u

type CachePath = (identityName: string) => string

const CacheSchema = z.object({
  version: z.literal(1),
  subject: z.string().min(1),
  listedAt: z.string().datetime(),
  truncated: z.boolean(),
  instances: z.array(
    z.object({
      organizationId: z.string(),
      name: z.string(),
      url: z.string(),
      slug: z.string(),
      region: z.string().optional(),
    }),
  ),
})

/** The sign-in a listing belongs to. */
export interface DirectoryIdentity {
  readonly name: string
  readonly subject: string
}

/** A listing served from the cache because the directory could not answer. */
export interface StaleDirectory {
  readonly listedAt: string
  /** The directory failure it stands in for. */
  readonly code: string
  readonly message: string
}

export interface DirectoryRead {
  readonly directory: InstanceDirectory
  /** Present when the listing is the last known one, served in place of a failed read. */
  readonly stale?: StaleDirectory
  /** True when a recent cached listing answered without asking the directory. */
  readonly cached?: boolean
}

export interface CachedDirectoryDependencies extends DirectoryDependencies {
  readonly identity?: (name: string | undefined) => Promise<DirectoryIdentity | undefined>
  readonly read?: (
    options: DirectoryReadOptions,
    dependencies: DirectoryDependencies,
  ) => Promise<InstanceDirectory>
  readonly now?: () => number
  /** Where an identity's listing is kept; the CLI state directory by default. */
  readonly cachePath?: CachePath
}

/**
 * Read the directory through the identity's last listing.
 * - `refresh`: always ask the directory (and keep its answer); the last listing stands in only
 *   when the directory is unavailable or rate-limited.
 * - `prefer-fresh`: a listing younger than `DIRECTORY_FRESH_MS` answers without a request.
 */
export async function readCachedInstanceDirectory(
  options: DirectoryReadOptions,
  mode: 'refresh' | 'prefer-fresh',
  dependencies: CachedDirectoryDependencies = {},
): Promise<DirectoryRead> {
  const now = dependencies.now ?? Date.now
  const cachePath = dependencies.cachePath ?? paths.instanceDirectoryCache
  const identity = await (dependencies.identity ?? cacheIdentity)(options.as)
  const last =
    identity === undefined ? undefined : await readLastListing(cachePath, identity, now())
  if (mode === 'prefer-fresh' && last !== undefined && last.ageMs < DIRECTORY_FRESH_MS) {
    return Object.freeze({ directory: last.directory, cached: true })
  }
  try {
    const directory = await (dependencies.read ?? readInstanceDirectory)(options, dependencies)
    if (identity !== undefined) {
      // A listing that cannot be kept is still a good answer: the cache only saves later reads.
      await writeLastListing(cachePath, identity, directory, now()).catch(() => undefined)
    }
    return Object.freeze({ directory })
  } catch (error) {
    if (!(error instanceof AstraleError) || !FALLBACK_CODES.has(error.code) || last === undefined) {
      throw error
    }
    return Object.freeze({
      directory: last.directory,
      stale: Object.freeze({ listedAt: last.listedAt, code: error.code, message: error.message }),
    })
  }
}

/** Forget the last listing of one identity (sign-out, identity removal). */
export async function forgetInstanceDirectory(
  identityName: string,
  cachePath: CachePath = paths.instanceDirectoryCache,
): Promise<void> {
  if (!SAFE_NAME.test(identityName)) return
  await unlink(cachePath(identityName)).catch(() => undefined)
}

/** "3 min", "2 h", "4 d": how old a listing is, for a warning. */
export function describeAge(listedAt: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(listedAt)) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.round(hours / 24)} d`
}

/** The sign-in whose listing is cached: an IdP identity with a subject, else none. */
async function cacheIdentity(name: string | undefined): Promise<DirectoryIdentity | undefined> {
  try {
    const identity =
      name === undefined ? await getDefault() : { ...(await getIdentity(name)), name }
    if (identity.source !== 'idp' || !identity.subject || !SAFE_NAME.test(identity.name)) {
      return undefined
    }
    return { name: identity.name, subject: identity.subject }
  } catch {
    // The directory read reports a missing identity itself.
    return undefined
  }
}

async function readLastListing(
  cachePath: CachePath,
  identity: DirectoryIdentity,
  now: number,
): Promise<{ directory: InstanceDirectory; listedAt: string; ageMs: number } | undefined> {
  let parsed: z.infer<typeof CacheSchema>
  try {
    parsed = CacheSchema.parse(JSON.parse(await readFile(cachePath(identity.name), 'utf8')))
  } catch {
    // Absent, unreadable or from another version: no last listing.
    return undefined
  }
  // Another account signed in under this identity name: its listing is not this one's.
  if (parsed.subject !== identity.subject) return undefined
  const ageMs = now - Date.parse(parsed.listedAt)
  if (ageMs < 0 || ageMs > DIRECTORY_STALE_MAX_MS) return undefined
  return {
    directory: Object.freeze({
      instances: Object.freeze(parsed.instances.map((instance) => Object.freeze(instance))),
      truncated: parsed.truncated,
    }),
    listedAt: parsed.listedAt,
    ageMs,
  }
}

async function writeLastListing(
  cachePath: CachePath,
  identity: DirectoryIdentity,
  directory: InstanceDirectory,
  now: number,
): Promise<void> {
  const body = {
    version: 1,
    subject: identity.subject,
    listedAt: new Date(now).toISOString(),
    truncated: directory.truncated,
    instances: directory.instances.map((instance) => ({
      organizationId: instance.organizationId,
      name: instance.name,
      url: instance.url,
      slug: instance.slug,
      ...(instance.region === undefined ? {} : { region: instance.region }),
    })),
  }
  await atomicWrite(cachePath(identity.name), `${JSON.stringify(body)}\n`)
}
