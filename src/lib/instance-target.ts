import type { InstanceInfo } from '../admin/instance/model'
import type { AstraleConfig } from './config'

import { AstraleError } from '../errors'
import {
  DEFAULT_ADMIN_TARGET_NAME,
  resolveAdminTarget,
  type AdminTargetCommandOpts,
  type ResolvedAdminTarget,
} from './admin-target'
import {
  getActive,
  normalizeInstanceKernelUrl,
  resolveInstance,
  resolveInstanceKey,
  type InstanceStore,
} from './instance'
import { validateSlug } from './validation'

export type InstanceTargetRequest =
  | { source: 'active' }
  | { source: 'name'; name: string }
  | { source: 'admin' }
  | { source: 'url'; url: string; name?: string; kernelIssuer?: string }

export type ResolvedInstanceTarget = {
  name?: string
  source: 'bookmark' | 'managed' | 'admin' | 'url'
  url: string
  kernelIssuer: string
  domainIssuer?: string
  defaultIdentity?: string
  caFile?: string
}

export type ResolveInstanceTargetOpts = {
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
      const active = opts.instances ? activeFromStore(opts.instances) : await getActive(opts.config)
      return resolveNamedInstanceTarget(active.name, opts)
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
  if (opts.instances) {
    const key = resolveInstanceKey(opts.instances, identifier)
    const entry = key ? opts.instances.instances[key] : undefined
    if (!key || !entry?.url) throw instanceNotFound(identifier)
    const url = normalizeInstanceKernelUrl(entry.url)
    return {
      name: key,
      source: 'bookmark',
      url,
      kernelIssuer: entry.issuer ? normalizeInstanceKernelUrl(entry.issuer) : url,
      domainIssuer: entry.domainIssuer,
      defaultIdentity: entry.defaultIdentity,
      caFile: entry.caFile,
    }
  }

  const resolved = await resolveInstance(identifier, opts.config)
  return {
    name: resolved.name,
    source: 'bookmark',
    url: resolved.url,
    kernelIssuer: resolved.issuer ?? resolved.url,
    domainIssuer: resolved.domainIssuer,
    defaultIdentity: resolved.defaultIdentity,
    caFile: resolved.caFile,
  }
}

function activeFromStore(store: InstanceStore): { name: string } {
  if (!store.active) {
    throw new Error('No active instance. Run: astrale instance bookmark <name> --url <url> --use')
  }
  return { name: store.active }
}

function instanceNotFound(identifier: string): AstraleError {
  return new AstraleError(
    'INSTANCE_NOT_FOUND',
    `Instance "${identifier}" is not bookmarked.\n` +
      `  Bookmark: astrale instance bookmark ${identifier} --url <url>\n` +
      `  Or pass --url <kernel-url> directly.`,
  )
}

export function couldBeConfiguredAdminInstance(identifier: string, config: AstraleConfig): boolean {
  const admin = config.admin
  if (admin.instance) return identifier === admin.instance
  return identifier === (admin.name ?? DEFAULT_ADMIN_TARGET_NAME)
}

export function adminTargetToInstance(target: ResolvedAdminTarget): ResolvedInstanceTarget {
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

const ADMIN_DISCOVERY_CODES = new Set([
  'TOKEN_EXCHANGE_SOURCE_INVALID',
  'TOKEN_EXCHANGE_SOURCE_EXPIRED',
  'TOKEN_EXCHANGE_UNSUPPORTED',
  'TOKEN_EXCHANGE_DISCOVERY_FAILED',
  'TOKEN_EXCHANGE_PROTOCOL_ERROR',
  'TOKEN_EXCHANGE_INSECURE',
  'ADMIN_DOMAIN_ISSUER_MISSING',
  'ADMIN_INVENTORY_UNAVAILABLE',
])

/** Admin lookup failed before it could say whether the slug exists. */
export function isAdminDiscoveryFailure(error: unknown): boolean {
  return error instanceof AstraleError && ADMIN_DISCOVERY_CODES.has(error.code)
}

export function isManagedInstanceNotFound(error: unknown): boolean {
  if (error instanceof AstraleError && error.code === 'INSTANCE_NOT_FOUND') return true
  if (!(error instanceof Error)) return false
  if (error.name === 'NotFoundError') return true
  // The admin kernel reports a missing instance node as InternalKernelError
  // with a NOT_FOUND-prefixed message. In this lookup that's an instance
  // miss (config problem), not a kernel fault — map it so callers get the
  // typed INSTANCE_NOT_FOUND with remediation instead of a raw kernel error.
  if (error.name === 'InternalKernelError' && /^NOT_FOUND\b/.test(error.message)) return true
  const data = (error as Error & { data?: unknown }).data
  return (
    error.name === 'KernelError' &&
    !!data &&
    typeof data === 'object' &&
    (data as { type?: unknown }).type === 'NotFoundError'
  )
}
