import type { AstraleConfig } from '../config'

import { AdminInstanceNotFoundError, type InstanceInfo } from '../../admin/instance/model'
import { AstraleError } from '../../errors'
import {
  DEFAULT_ADMIN_TARGET_NAME,
  resolveAdminTarget,
  type AdminTargetCommandOpts,
  type ResolvedAdminTarget,
} from '../admin/target'
import { validateSlug } from '../validation'
import {
  activeName,
  bookmarkIn,
  normalizeInstanceKernelUrl,
  readInstances,
  resolveInstance,
  type InstanceStore,
} from './bookmarks'

type InstanceTargetRequest =
  | { source: 'active' }
  | { source: 'name'; name: string }
  | { source: 'admin' }
  | { source: 'url'; url: string; name?: string; kernelIssuer?: string }

export type ResolvedInstanceTarget = {
  name?: string
  source: 'bookmark' | 'managed' | 'admin' | 'url'
  url: string
  kernelIssuer: string
  /** Exact Domain issuer the selected identity is exchanged at. */
  domainIssuer?: string
  defaultIdentity?: string
  caFile?: string
}

type ResolveInstanceTargetOpts = {
  config: AstraleConfig
  instances?: InstanceStore
  admin?: AdminTargetCommandOpts
  managed?: (slug: string) => Promise<InstanceInfo>
}

export async function resolveInstanceTarget(
  request: InstanceTargetRequest,
  opts: ResolveInstanceTargetOpts,
): Promise<ResolvedInstanceTarget> {
  switch (request.source) {
    case 'active': {
      return resolveNamedInstanceTarget(activeName(opts.instances ?? (await readInstances())), opts)
    }
    case 'name':
      return resolveNamedInstanceTarget(request.name, opts)
    case 'admin':
      return adminTargetToInstance(
        await resolveAdminTarget(opts.admin ?? {}, opts.config, opts.instances),
      )
    case 'url':
      return {
        name: request.name,
        source: 'url',
        url: request.url,
        kernelIssuer: request.kernelIssuer ?? request.url,
      }
  }
}

async function resolveNamedInstanceTarget(
  identifier: string,
  opts: ResolveInstanceTargetOpts,
): Promise<ResolvedInstanceTarget> {
  let notFound: AstraleError
  try {
    return await resolveBookmarkedInstanceTarget(identifier, opts)
  } catch (e) {
    if (!(e instanceof AstraleError) || e.code !== 'INSTANCE_NOT_FOUND') throw e
    notFound = e
  }

  if (couldBeConfiguredAdminInstance(identifier, opts.config)) {
    const admin = await resolveAdminTarget(opts.admin ?? {}, opts.config, opts.instances)
    const target = adminTargetToInstance(admin)
    if (identifier === target.name) return target
  }

  try {
    validateSlug(identifier)
  } catch {
    throw notFound
  }
  if (!opts.managed) throw notFound

  let managed: InstanceInfo
  try {
    managed = await opts.managed(identifier)
  } catch (e) {
    if (isManagedInstanceNotFound(e) || isAdminDiscoveryFailure(e)) throw notFound
    throw e
  }

  // A managed Instance's users act for themselves: no Domain principal scopes their commands.
  const url = normalizeInstanceKernelUrl(managed.url)
  return {
    name: managed.slug,
    source: 'managed',
    url,
    kernelIssuer: url,
  }
}

async function resolveBookmarkedInstanceTarget(
  identifier: string,
  opts: ResolveInstanceTargetOpts,
): Promise<ResolvedInstanceTarget> {
  const bookmark = opts.instances
    ? bookmarkIn(opts.instances, identifier)
    : await resolveInstance(identifier)
  return {
    name: bookmark.name,
    source: 'bookmark',
    url: bookmark.url,
    kernelIssuer: bookmark.issuer ?? bookmark.url,
    ...(bookmark.domainIssuer === undefined ? {} : { domainIssuer: bookmark.domainIssuer }),
    defaultIdentity: bookmark.defaultIdentity,
    caFile: bookmark.caFile,
  }
}

function couldBeConfiguredAdminInstance(identifier: string, config: AstraleConfig): boolean {
  const admin = config.admin
  if (admin.instance) return identifier === admin.instance
  return identifier === (admin.name ?? DEFAULT_ADMIN_TARGET_NAME)
}

function adminTargetToInstance(target: ResolvedAdminTarget): ResolvedInstanceTarget {
  return {
    name: target.registrationSlug,
    source: 'admin',
    url: target.url,
    kernelIssuer: target.kernelIssuer,
    ...(target.domainIssuer === undefined ? {} : { domainIssuer: target.domainIssuer }),
    defaultIdentity: target.defaultIdentity,
    ...(target.caFile ? { caFile: target.caFile } : {}),
  }
}

/** Why the caller could not reach the Admin Domain at all: no credential for it, or no Admin. */
export const ADMIN_UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  'TOKEN_EXCHANGE_SOURCE_INVALID',
  'TOKEN_EXCHANGE_SOURCE_EXPIRED',
  'TOKEN_EXCHANGE_UNSUPPORTED',
  'TOKEN_EXCHANGE_DISCOVERY_FAILED',
  'TOKEN_EXCHANGE_PROTOCOL_ERROR',
  'TOKEN_EXCHANGE_INSECURE',
  'ADMIN_DOMAIN_ISSUER_MISSING',
])

/** Admin lookup failed before it could say whether the slug exists. */
function isAdminDiscoveryFailure(error: unknown): boolean {
  return (
    error instanceof AstraleError &&
    (ADMIN_UNREACHABLE_CODES.has(error.code) || error.code === 'ADMIN_INVENTORY_UNAVAILABLE')
  )
}

function isManagedInstanceNotFound(error: unknown): boolean {
  return (
    error instanceof AdminInstanceNotFoundError ||
    (error instanceof AstraleError && error.code === 'INSTANCE_NOT_FOUND')
  )
}
