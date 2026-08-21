import { z } from 'zod'

import type { AstraleConfig } from './config'
import type { InstanceStore } from './instance'

import { AstraleError } from '../errors'
import { readInstances, resolveInstanceKey } from './instance'
import { DEFAULT_UPDATE_CHANNEL } from './update'
import { isHttpUrl } from './validation'

export const DEFAULT_ADMIN_TARGET_NAME = 'admin'

export function defaultAdminTargetForChannel(channel: string): {
  readonly url: string
  readonly domainIssuer: string
} {
  return channel === 'stable'
    ? {
        url: 'https://admin.eu.astrale.ai/api',
        domainIssuer: 'https://admin.astrale.ai',
      }
    : {
        url: 'https://admin.eu.beta.astrale.ai/api',
        domainIssuer: 'https://admin.beta.astrale.ai',
      }
}

const DEFAULT_ADMIN_TARGET = defaultAdminTargetForChannel(DEFAULT_UPDATE_CHANNEL)

export const DEFAULT_ADMIN_TARGET_URL = DEFAULT_ADMIN_TARGET.url
export const DEFAULT_ADMIN_DOMAIN_ISSUER = DEFAULT_ADMIN_TARGET.domainIssuer

export const DEFAULT_ADMIN_TARGET_CONFIG = {
  name: DEFAULT_ADMIN_TARGET_NAME,
  url: DEFAULT_ADMIN_TARGET_URL,
  kernelIssuer: DEFAULT_ADMIN_TARGET_URL,
  domainIssuer: DEFAULT_ADMIN_DOMAIN_ISSUER,
} satisfies AdminTargetConfig

const HttpUrlSchema = z.string().refine(isHttpUrl, {
  message: 'expected a valid http:// or https:// URL',
})

export const AdminTargetConfigSchema = z
  .object({
    /** Friendly name / auth registration slug for direct URL admin targets. */
    name: z.string().min(1).optional(),
    /** Direct admin kernel URL. */
    url: HttpUrlSchema.optional(),
    /** Kernel issuer / JWT audience when different from url. */
    kernelIssuer: HttpUrlSchema.optional(),
    /** Exact native Admin Domain issuer used by the standard token exchange. */
    domainIssuer: HttpUrlSchema.optional(),
    /** Bookmark name for the admin kernel. */
    instance: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.url && value.instance) {
      ctx.addIssue({
        code: 'custom',
        path: ['instance'],
        message: 'admin target must use either url or instance, not both',
      })
    }
    if (!value.url && !value.instance) {
      ctx.addIssue({
        code: 'custom',
        message: 'admin target requires url or instance',
      })
    }
    if (value.kernelIssuer && !value.url) {
      ctx.addIssue({
        code: 'custom',
        path: ['kernelIssuer'],
        message: 'admin kernel issuer is only valid with a direct url target',
      })
    }
    if (value.domainIssuer && !value.url) {
      ctx.addIssue({
        code: 'custom',
        path: ['domainIssuer'],
        message: 'admin domain issuer is only valid with a direct url target',
      })
    }
  })

export type AdminTargetConfig = z.infer<typeof AdminTargetConfigSchema>

export type AdminTargetCommandOpts = {
  admin?: string
  adminUrl?: string
  domainIssuer?: string
  instance?: string
  url?: string
}

export type AdminTargetSource = 'admin-url' | 'admin' | 'config-instance' | 'config-url' | 'default'

export type ResolvedAdminTarget = {
  name: string
  url: string
  kernelIssuer: string
  domainIssuer: string
  defaultIdentity?: string
  caFile?: string
  source: AdminTargetSource
  configured: boolean
  registrationSlug: string
}

export const ADMIN_TARGET_OPTIONS = [
  {
    flags: '--admin <name>',
    description: 'Admin kernel bookmark to use for this admin operation',
  },
  {
    flags: '--admin-url <url>',
    description: 'Admin kernel URL to use for this admin operation',
  },
  {
    flags: '--domain-issuer <url>',
    description: 'Admin Domain issuer used for token exchange with an explicit URL',
  },
]

export async function resolveAdminTarget(
  opts: AdminTargetCommandOpts,
  config: AstraleConfig,
  store?: InstanceStore,
): Promise<ResolvedAdminTarget> {
  return resolveAdminTargetFromStore(opts, config, store ?? (await readInstances()))
}

export function resolveAdminTargetFromStore(
  opts: AdminTargetCommandOpts,
  config: AstraleConfig,
  store: InstanceStore,
): ResolvedAdminTarget {
  const override = readOverride(opts)
  if (override) {
    if (override.kind === 'instance' && opts.domainIssuer !== undefined) {
      throw new AstraleError(
        'INVALID_FLAG',
        '--domain-issuer is only valid with --admin-url or --url.',
      )
    }
    return override.kind === 'url'
      ? directTarget({
          url: override.url,
          name: DEFAULT_ADMIN_TARGET_NAME,
          source: override.source,
          configured: false,
          domainIssuer: opts.domainIssuer ?? config.admin.domainIssuer,
        })
      : bookmarkTarget(
          store,
          override.instance,
          override.source,
          false,
          config.admin.domainIssuer ?? DEFAULT_ADMIN_DOMAIN_ISSUER,
        )
  }

  const admin = config.admin
  if (admin.instance) {
    return bookmarkTarget(
      store,
      admin.instance,
      'config-instance',
      true,
      admin.domainIssuer ?? DEFAULT_ADMIN_DOMAIN_ISSUER,
    )
  }

  const isDefaultDirectTarget =
    admin.url === DEFAULT_ADMIN_TARGET_URL &&
    admin.kernelIssuer === DEFAULT_ADMIN_TARGET_URL &&
    (admin.domainIssuer ?? DEFAULT_ADMIN_DOMAIN_ISSUER) === DEFAULT_ADMIN_DOMAIN_ISSUER &&
    admin.name === DEFAULT_ADMIN_TARGET_NAME

  return directTarget({
    url: admin.url ?? DEFAULT_ADMIN_TARGET_URL,
    kernelIssuer: admin.kernelIssuer,
    domainIssuer: admin.domainIssuer ?? DEFAULT_ADMIN_DOMAIN_ISSUER,
    name: admin.name ?? DEFAULT_ADMIN_TARGET_NAME,
    source: isDefaultDirectTarget ? 'default' : 'config-url',
    configured: !isDefaultDirectTarget,
  })
}

function readOverride(opts: AdminTargetCommandOpts):
  | { kind: 'url'; url: string; source: AdminTargetSource }
  | {
      kind: 'instance'
      instance: string
      source: AdminTargetSource
    }
  | null {
  const selected = [
    opts.adminUrl ? { label: '--admin-url', kind: 'url' as const, value: opts.adminUrl } : null,
    opts.admin ? { label: '--admin', kind: 'instance' as const, value: opts.admin } : null,
    opts.url ? { label: '--url', kind: 'url' as const, value: opts.url } : null,
    opts.instance
      ? { label: '-i/--instance', kind: 'instance' as const, value: opts.instance }
      : null,
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  if (selected.length > 1) {
    throw new AstraleError(
      'INVALID_FLAG',
      `Choose one admin target override, not ${selected.map((entry) => entry.label).join(', ')}`,
      'Use --admin <bookmark> or --admin-url <url> for admin operations.',
    )
  }

  const first = selected[0]
  if (!first) return null
  if (first.kind === 'url') {
    return {
      kind: 'url',
      url: first.value,
      source: 'admin-url',
    }
  }
  return {
    kind: 'instance',
    instance: first.value,
    source: 'admin',
  }
}

function bookmarkTarget(
  store: InstanceStore,
  identifier: string,
  source: AdminTargetSource,
  configured: boolean,
  domainIssuer: string,
): ResolvedAdminTarget {
  const key = resolveInstanceKey(store, identifier)
  const entry = key ? store.instances[key] : undefined
  if (!key || !entry?.url) {
    throw new AstraleError(
      'ADMIN_TARGET_NOT_FOUND',
      `Admin target "${identifier}" is not bookmarked.`,
      `Bookmark it first: astrale instance bookmark ${identifier} --url <admin-url>`,
    )
  }
  return {
    name: key,
    registrationSlug: key,
    url: entry.url,
    kernelIssuer: entry.issuer ?? entry.url,
    domainIssuer: requireDomainIssuer(
      entry.domainIssuer ?? (configured ? domainIssuer : undefined),
      `Admin bookmark "${key}"`,
    ),
    defaultIdentity: entry.defaultIdentity,
    ...(entry.caFile ? { caFile: entry.caFile } : {}),
    source,
    configured,
  }
}

function directTarget(input: {
  url: string
  kernelIssuer?: string
  domainIssuer?: string
  name: string
  source: AdminTargetSource
  configured: boolean
}): ResolvedAdminTarget {
  return {
    name: input.name,
    registrationSlug: input.name,
    url: input.url,
    kernelIssuer: input.kernelIssuer ?? input.url,
    domainIssuer: requireDomainIssuer(input.domainIssuer, 'Direct Admin target'),
    source: input.source,
    configured: input.configured,
  }
}

function requireDomainIssuer(value: string | undefined, label: string): string {
  if (value !== undefined) return value
  throw new AstraleError(
    'ADMIN_DOMAIN_ISSUER_MISSING',
    `${label} has no Domain issuer for token exchange.`,
    'Configure domainIssuer or pass --domain-issuer <url>; there is no legacy token fallback.',
  )
}
