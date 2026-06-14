import { decodeJwt } from 'jose'

import type { AstraleConfig } from './config'

import { resolveAdminTargetFromStore } from './admin-target'
import { DEFAULT_CONFIG, readConfig } from './config'
import { readIdentities, type IdentityStore } from './identity'
import { readIdpSession, type IdpSession } from './idp'
import { readInstances, type InstanceStore } from './instance'

export type LocalInstanceStatus = {
  active: string
  url: string
  issuer: string | null
  defaultIdentity: string | null
} | null

export type LocalAdminStatus =
  | {
      name: string
      url: string
      issuer: string
      source: string
      configured: boolean
      registrationSlug: string
      identityRegistered: boolean
    }
  | {
      error: string
    }

export type LocalIdentityStatus = {
  name: string
  subject: string
  source: 'key' | 'idp'
  idp: string | null
  registeredOnActiveInstance: boolean
  registeredOnAdminTarget: boolean
  session: {
    cached: boolean
    expired?: boolean
    expiresAt?: string
    hasRefreshToken?: boolean
  } | null
} | null

export type LocalStatus = {
  admin: LocalAdminStatus
  instance: LocalInstanceStatus
  identity: LocalIdentityStatus
}

export type JwtExpiration = {
  expiresAt: string
  expired: boolean
}

export async function readLocalStatus(): Promise<LocalStatus> {
  const [instances, identities, config] = await Promise.all([
    // Read-only: status / `setup --plan` must never trigger a sanitize-writeback.
    readInstances(undefined, { persist: false }),
    readIdentities(),
    readConfig(),
  ])
  return buildLocalStatus(instances, identities, async (name) => readIdpSession(name), config)
}

export async function buildLocalStatus(
  instances: InstanceStore,
  identities: IdentityStore,
  readSession: (identityName: string) => Promise<IdpSession | null>,
  config: AstraleConfig = DEFAULT_CONFIG,
): Promise<LocalStatus> {
  const activeEntry = instances.active ? instances.instances[instances.active] : undefined
  const instance = instances.active
    ? {
        active: instances.active,
        url: activeEntry?.url ?? '',
        issuer: activeEntry?.issuer ?? null,
        defaultIdentity: activeEntry?.defaultIdentity ?? null,
      }
    : null

  const identityEntry = identities.identities[identities.default]
  const admin = buildAdminStatus(config, instances, identityEntry)
  if (!identityEntry) {
    return { admin, instance, identity: null }
  }

  const source = identityEntry.source ?? 'key'
  const session =
    source === 'idp'
      ? await readSession(identities.default)
          .then((value) => {
            if (!value) return { cached: false }
            const expiresAt =
              value.expires_at ??
              expClaimToIso(value.claims?.exp) ??
              expClaimToIso(identityEntry.claims?.exp)
            return {
              cached: true,
              expired: expiresAt ? Date.parse(expiresAt) <= Date.now() + 60_000 : false,
              expiresAt,
              hasRefreshToken: !!value.refresh_token,
            }
          })
          .catch(() => ({ cached: false }))
      : null

  return {
    admin,
    instance,
    identity: {
      name: identities.default,
      subject: identityEntry.subject,
      source,
      idp: identityEntry.idp ?? null,
      registeredOnActiveInstance: !!(
        instances.active && identityEntry.registrations?.[instances.active]
      ),
      registeredOnAdminTarget:
        'registrationSlug' in admin
          ? !!identityEntry.registrations?.[admin.registrationSlug]
          : false,
      session,
    },
  }
}

function buildAdminStatus(
  config: AstraleConfig,
  instances: InstanceStore,
  identityEntry: IdentityStore['identities'][string] | undefined,
): LocalAdminStatus {
  try {
    const target = resolveAdminTargetFromStore({}, config, instances)
    return {
      name: target.name,
      url: target.url,
      issuer: target.issuer,
      source: target.source,
      configured: target.configured,
      registrationSlug: target.registrationSlug,
      identityRegistered: !!identityEntry?.registrations?.[target.registrationSlug],
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function expClaimToIso(value: unknown): string | undefined {
  if (typeof value !== 'number') return undefined
  return new Date(value * 1000).toISOString()
}

export function decodeJwtExpiration(token: string, nowMs = Date.now()): JwtExpiration | null {
  try {
    const payload = decodeJwt(token)
    if (typeof payload.exp !== 'number') return null
    const expiresMs = payload.exp * 1000
    return {
      expiresAt: new Date(expiresMs).toISOString(),
      expired: expiresMs <= nowMs,
    }
  } catch {
    return null
  }
}
