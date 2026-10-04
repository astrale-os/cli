import type { InstalledPin } from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'

import { call, ResponseError } from '@astrale-os/sdk/client'
import { Path } from '@astrale-os/sdk/graph/path'

import type {
  FleetInstallationsV1,
  FleetInstallationV1,
  FleetReleaseDigest,
  FleetUnreachableV1,
} from './model'

import { AstraleError } from '../../errors'
import { AdminContract } from '../contract'
import { registryFailure } from '../registry/failure'
import { RegistryError } from '../registry/model'
import { FLEET_UNREACHABLE_REASONS } from './model'

/** The static Method of CT37, addressed on Admin's Fleet Class without schema discovery. */
const INSTALLATIONS = Path.parse(`/:${AdminContract.origin}:class.Fleet:installations`)

/** Most pages one listing follows: 100 Instances a page at most, far above any Fleet today. */
export const MAXIMUM_INSTALLATION_PAGES = 200

/** Most release digests one call filters on (CT37 input bound). */
export const MAXIMUM_RELEASE_FILTER = 256

const DIGEST = /^sha256:[0-9a-f]{64}$/u
const REASONS: ReadonlySet<string> = new Set(FLEET_UNREACHABLE_REASONS)

export interface AdminFleetContext {
  readonly session: Pick<ClientSession, 'call'>
}

export interface AdminFleetApi {
  /**
   * Which Instances of the Fleets the caller administers pin `origin` (AM-38), every page joined.
   * With `releases`, only the pins of those release digests; a legacy pin names no release and is
   * then never listed.
   */
  installations(
    origin: string,
    options?: { readonly releases?: readonly FleetReleaseDigest[] },
  ): Promise<FleetInstallationsV1>
}

/**
 * `Fleet.installations` (CT37) as the CLI calls it: a static Method of Admin, with the caller's own
 * credential. Admin decides the Fleets per Fleet with `AdministerFleet` and reads each Instance's
 * Kernel itself; the CLI only follows the cursor and admits each page. An Instance Admin could not
 * read is a row of `unreachable` with its reason, which means unknown, never "not installed".
 */
export function connectAdminFleet(context: AdminFleetContext): AdminFleetApi {
  return Object.freeze({
    async installations(
      origin: string,
      options: { readonly releases?: readonly FleetReleaseDigest[] } = {},
    ): Promise<FleetInstallationsV1> {
      const releases = options.releases === undefined ? undefined : releaseFilter(options.releases)
      const installations: FleetInstallationV1[] = []
      const unreachable: FleetUnreachableV1[] = []
      const seen = new Set<string>()
      let cursor: string | undefined
      try {
        for (let page = 0; ; page += 1) {
          if (page === MAXIMUM_INSTALLATION_PAGES) {
            throw responseInvalid(`Admin answered more than ${MAXIMUM_INSTALLATION_PAGES} pages.`)
          }
          const answer = installationsPage(
            await context.session.call(
              call(INSTALLATIONS, {
                origin,
                ...(releases === undefined ? {} : { releases: [...releases] }),
                ...(cursor === undefined ? {} : { cursor }),
              }),
            ),
          )
          installations.push(...answer.installations)
          unreachable.push(...answer.unreachable)
          if (answer.cursor === undefined) break
          // A cursor names the position after the last Instance read: one seen again would loop.
          if (seen.has(answer.cursor))
            throw responseInvalid('Admin answered a cursor it already gave.')
          seen.add(answer.cursor)
          cursor = answer.cursor
        }
      } catch (error) {
        if (error instanceof ResponseError && error.code === 2004) {
          return document(origin, releases, false, [], [])
        }
        throw installationsFailure(error)
      }
      return document(origin, releases, true, installations, unreachable)
    },
  })
}

function document(
  origin: string,
  releases: readonly FleetReleaseDigest[] | undefined,
  fleetView: boolean,
  installations: readonly FleetInstallationV1[],
  unreachable: readonly FleetUnreachableV1[],
): FleetInstallationsV1 {
  return Object.freeze({
    format: 'astrale.fleet-installations',
    version: 1,
    origin,
    ...(releases === undefined ? {} : { releases: Object.freeze([...releases]) }),
    fleetView,
    installations: Object.freeze([...installations]),
    unreachable: Object.freeze([...unreachable]),
  })
}

/** Admit the release filter before any request: distinct `sha256:` digests, in the order given. */
export function releaseFilter(input: readonly string[]): readonly FleetReleaseDigest[] {
  const unique = [...new Set(input)]
  if (unique.length === 0 || unique.length > MAXIMUM_RELEASE_FILTER) {
    throw new AstraleError(
      'INVALID_ARGUMENT',
      `Name between 1 and ${MAXIMUM_RELEASE_FILTER} distinct release digests.`,
    )
  }
  for (const digest of unique) {
    if (!DIGEST.test(digest)) {
      throw new AstraleError(
        'INVALID_ARGUMENT',
        `${JSON.stringify(digest)} is not a release digest: sha256: and 64 lower-case hex digits.`,
      )
    }
  }
  return Object.freeze(unique as FleetReleaseDigest[])
}

/**
 * The CT29 vocabulary for a refusal of the listing. A Kernel that knows no `Fleet.installations`
 * answers that the Method is not found: that Admin predates A15, which the caller can only wait
 * for, so it is unavailable rather than an absent Domain.
 */
function installationsFailure(error: unknown) {
  if (error instanceof ResponseError && (error.code === 3001 || error.code === 3002)) {
    return new RegistryError(
      'REGISTRY_UNAVAILABLE',
      'This Admin does not list Fleet installations (Fleet.installations is not installed).',
      { status: error.code, reason: 'unsupported' },
      { cause: error },
    )
  }
  return registryFailure(error, 'read')
}

/** One admitted CT37 page; fields Admin adds later are ignored. */
function installationsPage(input: unknown): {
  readonly installations: readonly FleetInstallationV1[]
  readonly unreachable: readonly FleetUnreachableV1[]
  readonly cursor?: string
} {
  const value = record(input, 'Fleet installations')
  const installations = array(value.installations, 'installations').map(installation)
  const unreachable = array(value.unreachable, 'unreachable').map(unreachableRow)
  if (value.cursor !== undefined && (typeof value.cursor !== 'string' || value.cursor === ''))
    throw invalid('Fleet installations cursor')
  return {
    installations,
    unreachable,
    ...(value.cursor === undefined ? {} : { cursor: value.cursor as string }),
  }
}

function installation(input: unknown): FleetInstallationV1 {
  const value = record(input, 'Fleet installation')
  const instance = record(value.instance, 'Fleet installation instance')
  return Object.freeze({
    fleet: nodePath(value.fleet, 'Fleet installation fleet'),
    instance: Object.freeze({
      id: nodePath(instance.id, 'Fleet installation instance id'),
      slug: string(instance.slug, 'Fleet installation instance slug'),
    }),
    pin: pin(value.pin),
    url: httpUrl(value.url, 'Fleet installation url'),
  })
}

function unreachableRow(input: unknown): FleetUnreachableV1 {
  const value = record(input, 'Fleet unreachable instance')
  const reason = string(value.reason, 'Fleet unreachable reason')
  if (!REASONS.has(reason)) throw invalid('Fleet unreachable reason')
  return Object.freeze({
    instance: nodePath(value.instance, 'Fleet unreachable instance'),
    reason: reason as FleetUnreachableV1['reason'],
  })
}

/** CT12 `InstalledPin`, one meaning per variant. */
function pin(input: unknown): InstalledPin {
  const value = record(input, 'Fleet installation pin')
  if (value.kind === 'release') {
    return Object.freeze({
      kind: 'release',
      release: digest(value.release, 'release digest'),
      build: digest(value.build, 'build digest'),
    }) as InstalledPin
  }
  if (value.kind === 'legacy' && (value.document === 2 || value.document === 3)) {
    return Object.freeze({
      kind: 'legacy',
      document: value.document,
      etag: digest(value.etag, 'legacy pin etag'),
    }) as InstalledPin
  }
  throw invalid('Fleet installation pin')
}

function record(input: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw invalid(label)
  return input as Readonly<Record<string, unknown>>
}

function array(input: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(input)) throw invalid(`Fleet ${label}`)
  return input
}

function string(input: unknown, label: string): string {
  if (typeof input !== 'string' || input === '') throw invalid(label)
  return input
}

function nodePath(input: unknown, label: string): string {
  const value = string(input, label)
  try {
    Path.parse(value)
  } catch {
    throw invalid(label)
  }
  return value
}

function digest(input: unknown, label: string): `sha256:${string}` {
  if (typeof input !== 'string' || !DIGEST.test(input)) throw invalid(label)
  return input as `sha256:${string}`
}

function httpUrl(input: unknown, label: string): string {
  const value = string(input, label)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalid(label)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid(label)
  return value
}

function invalid(label: string): RegistryError {
  return responseInvalid(`Admin answered an invalid ${label}.`)
}

function responseInvalid(message: string): RegistryError {
  return new RegistryError('REGISTRY_UNAVAILABLE', message, { reason: 'response-invalid' })
}
