import type { InstanceInfo } from '../../admin/instance'

import { AstraleError } from '../../errors'
import { normalizeInstanceKernelUrl } from '../instance/bookmarks'

/**
 * Ownership of an Instance in the Admin sense: the Admin Policy
 * `OwnInstanceOrAdministerAdminInstance` on its Admin Instance node, the one Policy that lets a
 * caller retrieve the Instance's root token. Being able to see or use an Instance - the caller
 * Instance list, a local bookmark, a directory membership - is not ownership.
 */
export type InstanceOwnership =
  | { readonly status: 'owned'; readonly instance: string }
  | { readonly status: 'not-owner'; readonly instance: string }
  /** No caller-visible Admin Instance serves this Kernel: a local or foreign Kernel. */
  | { readonly status: 'not-managed' }
  /** Several caller-visible Admin Instances claim this Kernel; none is chosen. */
  | { readonly status: 'ambiguous' }

/** Where a local connection reaches its Kernel, as a bookmark or a connection target records it. */
export interface KernelLocation {
  readonly url?: string | null
  /** The Kernel issuer; a bookmark without one is issued by its URL. */
  readonly issuer?: string | null
}

/**
 * One comparable form of a Kernel URL or issuer: a region-routed Instance root resolves to its
 * `/api`, as bookmarks record it, and a trailing slash never distinguishes two Kernels.
 */
export function kernelKey(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(normalizeInstanceKernelUrl(value))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`
  } catch {
    return undefined
  }
}

/**
 * The Admin Instance behind one local Kernel connection. The Kernel issuer is the Instance's
 * identity: when Admin records one, only it decides; otherwise the normalized Kernel URLs must
 * agree. A retired Instance never matches, and several matches are ambiguous rather than a guess.
 */
export function matchAdminInstance<Instance extends Pick<InstanceInfo, 'url' | 'issuer' | 'state'>>(
  kernel: KernelLocation,
  instances: readonly Instance[],
): Instance | 'ambiguous' | undefined {
  const issuer = kernelKey(kernel.issuer ?? kernel.url)
  const url = kernelKey(kernel.url)
  const matches = instances.filter((instance) => {
    if (instance.state === 'deleted') return false
    const recorded = kernelKey(instance.issuer)
    if (recorded !== undefined) return recorded === issuer
    const served = kernelKey(instance.url)
    return served !== undefined && served === url
  })
  if (matches.length > 1) return 'ambiguous'
  return matches[0]
}

/** Why an Instance is not one the caller owns, in the words Studio and the CLI show. */
export function ownershipReason(status: InstanceOwnership['status']): string {
  switch (status) {
    case 'owned':
      return 'Owner'
    case 'not-owner':
      return 'Not owner'
    case 'not-managed':
      return 'Not an Admin instance'
    case 'ambiguous':
      return 'Ambiguous Admin instance'
  }
}

/**
 * Refuse an operation reserved to the Instance's owner. The Admin root token behind it would be
 * refused anyway; this says why before any session starts.
 */
export function notOwnerError(ownership: Exclude<InstanceOwnership, { status: 'owned' }>) {
  const detail = {
    'not-owner': 'Admin does not record you as its owner.',
    'not-managed': 'No Admin instance you can see serves this Kernel (a local or foreign Kernel).',
    ambiguous: 'Several Admin instances you can see claim this Kernel.',
  }[ownership.status]
  return new AstraleError(
    'INSTANCE_NOT_OWNED',
    `You are not the owner of this instance in Admin: ${detail}`,
    'Views open as the instance owner only on an Admin instance you own. Switch to one of yours.',
  )
}
