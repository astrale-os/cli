import type { InstalledPin } from '@astrale-os/sdk/client/schema'

/**
 * Wire contracts of the Fleet installations plumbing (CT37 through CT24): which Instances of the
 * Fleets the caller administers pin a Domain's releases. `astrale __domain-registry installations`
 * prints one `FleetInstallationsV1`; `astrale-domain list` (S17) reads it for INSTALLÉ SUR.
 */

/** A `sha256:` release digest, as `Fleet.installations` filters on it. */
export type FleetReleaseDigest = `sha256:${string}`

/** One Instance of an administered Fleet and what it pins for the origin (CT37 `installations[]`). */
export interface FleetInstallationV1 {
  /** The Admin Fleet, as a Node path. */
  readonly fleet: string
  readonly instance: { readonly id: string; readonly slug: string }
  /** What the Instance's Kernel lists for the origin: CT12 `InstalledPin`, one meaning per variant. */
  readonly pin: InstalledPin
  /** The HTTP(S) origin the pinned document was discovered at, as the Instance's Kernel lists it. */
  readonly url: string
}

/** Why Admin could not tell what one Instance pins (CT37 `unreachable[].reason`). */
export const FLEET_UNREACHABLE_REASONS = [
  'timeout',
  'refused',
  'unavailable',
  'unsupported',
] as const

export type FleetUnreachableReason = (typeof FLEET_UNREACHABLE_REASONS)[number]

/**
 * An Instance whose installations are unknown: a partial row, never "not installed" (AM-198).
 * `unsupported` is a Kernel without the `installed` listing, such as the 1Pact Host on beta.117.
 */
export interface FleetUnreachableV1 {
  /** The Admin Instance, as a Node path. */
  readonly instance: string
  readonly reason: FleetUnreachableReason
}

/**
 * Every page of `Fleet.installations` for one origin, joined. `fleetView: false` is Admin's 2004
 * for a caller outside the central Shell's members: such a caller has no Fleet view, which is not
 * an error, and both lists are empty (AM-198). A member who administers no Fleet has a view and
 * empty lists.
 */
export interface FleetInstallationsV1 {
  readonly format: 'astrale.fleet-installations'
  readonly version: 1
  readonly origin: string
  /** The release digests the listing was filtered to; absent, every pin is listed, legacy ones included. */
  readonly releases?: readonly FleetReleaseDigest[]
  readonly fleetView: boolean
  readonly installations: readonly FleetInstallationV1[]
  readonly unreachable: readonly FleetUnreachableV1[]
}
