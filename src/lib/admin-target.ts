import { z } from 'zod'

import type { AstraleConfig } from './config'
import type { InstanceStore } from './instance'

import { AstraleError } from '../errors'
import { readInstances, resolveInstanceKey } from './instance'
import { isHttpUrl } from './validation'

export const DEFAULT_ADMIN_TARGET_NAME = 'admin'
export const DEFAULT_ADMIN_TARGET_URL = 'https://admin.eu.astrale.ai/api'

export const DEFAULT_ADMIN_TARGET_CONFIG = {
  name: DEFAULT_ADMIN_TARGET_NAME,
  url: DEFAULT_ADMIN_TARGET_URL,
  issuer: DEFAULT_ADMIN_TARGET_URL,
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
    issuer: HttpUrlSchema.optional(),
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
    if (value.issuer && !value.url) {
      ctx.addIssue({
        code: 'custom',
        path: ['issuer'],
        message: 'admin issuer is only valid with a direct url target',
      })
    }
  })

export type AdminTargetConfig = z.infer<typeof AdminTargetConfigSchema>

export type AdminTargetCommandOpts = {
  admin?: string
  adminUrl?: string
  instance?: string
  url?: string
}

export type AdminTargetSource =
  | 'admin-url'
  | 'admin'
  | 'legacy-url'
  | 'legacy-instance'
  | 'config-instance'
  | 'config-url'
  | 'default'

export type ResolvedAdminTarget = {
  name: string
  url: string
  issuer: string
  defaultIdentity?: string
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
    return override.kind === 'url'
      ? directTarget({
          url: override.url,
          name: DEFAULT_ADMIN_TARGET_NAME,
          source: override.source,
          configured: false,
        })
      : bookmarkTarget(store, override.instance, override.source, false)
  }

  const admin = config.admin
  if (admin.instance) {
    return bookmarkTarget(store, admin.instance, 'config-instance', true)
  }

  const isDefaultDirectTarget =
    admin.url === DEFAULT_ADMIN_TARGET_URL &&
    admin.issuer === DEFAULT_ADMIN_TARGET_URL &&
    admin.name === DEFAULT_ADMIN_TARGET_NAME

  return directTarget({
    url: admin.url ?? DEFAULT_ADMIN_TARGET_URL,
    issuer: admin.issuer,
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
      source: first.label === '--admin-url' ? 'admin-url' : 'legacy-url',
    }
  }
  return {
    kind: 'instance',
    instance: first.value,
    source: first.label === '--admin' ? 'admin' : 'legacy-instance',
  }
}

function bookmarkTarget(
  store: InstanceStore,
  identifier: string,
  source: AdminTargetSource,
  configured: boolean,
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
    issuer: entry.issuer ?? entry.url,
    defaultIdentity: entry.defaultIdentity,
    source,
    configured,
  }
}

function directTarget(input: {
  url: string
  issuer?: string
  name: string
  source: AdminTargetSource
  configured: boolean
}): ResolvedAdminTarget {
  return {
    name: input.name,
    registrationSlug: input.name,
    url: input.url,
    issuer: input.issuer ?? input.url,
    source: input.source,
    configured: input.configured,
  }
}
