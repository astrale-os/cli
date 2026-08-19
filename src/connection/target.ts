import type { IssuerId } from '@astrale-os/sdk/auth'

import { issuer } from '@astrale-os/sdk/auth'

import type { InstanceInfo } from '../lib/admin-instance'
import type { AdminTargetCommandOpts } from '../lib/admin-target'
import type { AstraleConfig } from '../lib/config'
import type { InstanceStore } from '../lib/instance'
import type { ResolvedInstanceTarget } from '../lib/instance-target'

import { resolveInstanceTarget } from '../lib/instance-target'

export interface ConnectionOptions {
  readonly url?: string
  readonly instance?: string
  readonly timeout?: string
  readonly as?: string
  readonly creds?: string
  readonly anonymous?: boolean
}

export interface AdminConnectionOptions extends ConnectionOptions {
  readonly admin?: string
  readonly adminUrl?: string
  readonly domainIssuer?: string
}

export interface ConnectionTarget {
  readonly url: string
  readonly kernelIssuer: IssuerId
  readonly domainIssuer?: IssuerId
  readonly slug?: string
  readonly defaultIdentity?: string
  readonly caFile?: string
}

export interface TargetDependencies {
  readonly instances?: InstanceStore
  readonly managed?: (slug: string) => Promise<InstanceInfo>
}

/** Stable local identity-registration key for the exact selected source Kernel. */
export function registrationKeyForTarget(target: ConnectionTarget): string {
  return target.slug ?? target.url
}

/** Resolve the existing URL / instance / active precedence into one exact source Kernel. */
export async function resolveConnectionTarget(
  options: ConnectionOptions,
  config: AstraleConfig,
  dependencies: TargetDependencies = {},
): Promise<ConnectionTarget> {
  const request =
    options.url !== undefined && options.instance === undefined
      ? ({ source: 'url', url: options.url } as const)
      : options.instance !== undefined
        ? ({ source: 'name', name: options.instance } as const)
        : ({ source: 'active' } as const)
  const resolved = await resolveInstanceTarget(request, {
    config,
    ...(dependencies.instances === undefined ? {} : { instances: dependencies.instances }),
    admin: {},
    ...(dependencies.managed === undefined ? {} : { managed: dependencies.managed }),
  })
  return connectionTarget(resolved, options.url)
}

/** Resolve the configured Admin Domain target without entering managed-instance discovery. */
export async function resolveAdminConnectionTarget(
  options: AdminConnectionOptions,
  config: AstraleConfig,
  instances?: InstanceStore,
): Promise<ConnectionTarget> {
  const resolved = await resolveInstanceTarget(
    { source: 'admin' },
    {
      config,
      admin: adminLookupOptions(options),
      ...(instances === undefined ? {} : { instances }),
    },
  )
  return connectionTarget(resolved)
}

export function adminLookupOptions(options: AdminConnectionOptions): AdminTargetCommandOpts {
  return {
    ...(options.admin === undefined ? {} : { admin: options.admin }),
    ...(options.adminUrl === undefined ? {} : { adminUrl: options.adminUrl }),
    ...(options.domainIssuer === undefined ? {} : { domainIssuer: options.domainIssuer }),
    ...(options.instance === undefined ? {} : { instance: options.instance }),
    ...(options.url === undefined ? {} : { url: options.url }),
  }
}

function connectionTarget(
  resolved: ResolvedInstanceTarget,
  urlOverride?: string,
): ConnectionTarget {
  return Object.freeze({
    url: urlOverride ?? resolved.url,
    kernelIssuer: issuer.accept(resolved.kernelIssuer),
    ...(resolved.domainIssuer === undefined
      ? {}
      : { domainIssuer: issuer.accept(resolved.domainIssuer) }),
    ...(resolved.name === undefined ? {} : { slug: resolved.name }),
    ...(resolved.defaultIdentity === undefined
      ? {}
      : { defaultIdentity: resolved.defaultIdentity }),
    ...(resolved.caFile === undefined ? {} : { caFile: resolved.caFile }),
  })
}
