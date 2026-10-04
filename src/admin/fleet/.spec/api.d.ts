import type { InstalledPin } from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'

export type FleetReleaseDigest = `sha256:${string}`

export interface FleetInstallationV1 {
  readonly fleet: string
  readonly instance: { readonly id: string; readonly slug: string }
  readonly pin: InstalledPin
  readonly url: string
}

export declare const FLEET_UNREACHABLE_REASONS: readonly [
  'timeout',
  'refused',
  'unavailable',
  'unsupported',
]

export type FleetUnreachableReason = (typeof FLEET_UNREACHABLE_REASONS)[number]

export interface FleetUnreachableV1 {
  readonly instance: string
  readonly reason: FleetUnreachableReason
}

export interface FleetInstallationsV1 {
  readonly format: 'astrale.fleet-installations'
  readonly version: 1
  readonly origin: string
  readonly releases?: readonly FleetReleaseDigest[]
  readonly fleetView: boolean
  readonly installations: readonly FleetInstallationV1[]
  readonly unreachable: readonly FleetUnreachableV1[]
}

export declare const MAXIMUM_INSTALLATION_PAGES: number
export declare const MAXIMUM_RELEASE_FILTER: number

export interface AdminFleetContext {
  readonly session: Pick<ClientSession, 'call'>
}

export interface AdminFleetApi {
  installations(
    origin: string,
    options?: { readonly releases?: readonly FleetReleaseDigest[] },
  ): Promise<FleetInstallationsV1>
}

export function connectAdminFleet(context: AdminFleetContext): AdminFleetApi
export function releaseFilter(input: readonly string[]): readonly FleetReleaseDigest[]
