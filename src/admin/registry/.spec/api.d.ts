import type { ClientSession, ContentApi } from '@astrale-os/sdk/client/session'

import type { AstraleError } from '../../../errors.js'
import type { AdminGraphQueryApi } from '../../graph/.spec/api.js'

export type RegistryDigest = `sha256:${string}`

export interface PublicationBundleV1 {
  readonly digest: RegistryDigest
  readonly mediaType: string
  readonly size: number
}

export interface PublicationDependencyV1 {
  readonly origin: string
  readonly revision: string
}

export interface PublicationSummaryV1 {
  readonly version: string
  readonly url: string
  readonly releaseDigest: RegistryDigest
  readonly buildDigest: RegistryDigest
  readonly schemaRevision: string
  readonly bundle: PublicationBundleV1
  readonly dependencies: readonly PublicationDependencyV1[]
  readonly commit?: string
  readonly dirty: boolean
  readonly yanked: boolean
  readonly publishedAt: string
}

export interface RegistryIndexV1 {
  readonly format: 'astrale.registry-index'
  readonly version: 1
  readonly origin: string
  readonly publications: readonly PublicationSummaryV1[]
}

export interface RegistryBundleV1 {
  readonly format: 'astrale.registry-bundle'
  readonly version: 1
  readonly publication: { readonly origin: string; readonly version: string }
  readonly bundle: PublicationBundleV1
}

export interface PublishRequestV1 {
  readonly format: 'astrale.registry-publish-request'
  readonly version: 1
  readonly publication: {
    readonly origin: string
    readonly version: string
    readonly url: string
    readonly releaseDigest: RegistryDigest
    readonly commit?: string
    readonly dirty: boolean
  }
}

export interface PublishResultV1 {
  readonly format: 'astrale.registry-publish-result'
  readonly version: 1
  readonly status: 'created' | 'unchanged'
  readonly publication: PublicationSummaryV1
}

export interface YankResultV1 {
  readonly format: 'astrale.registry-yank-result'
  readonly version: 1
  readonly status: 'changed' | 'unchanged'
  readonly publication: PublicationSummaryV1
}

export declare const REGISTRY_ERROR_CODES: readonly [
  'REGISTRY_DOMAIN_NOT_FOUND',
  'PUBLICATION_NOT_FOUND',
  'REGISTRY_FORBIDDEN',
  'REGISTRY_UNAVAILABLE',
  'PUBLICATION_VERSION_CONFLICT',
  'PUBLICATION_RELEASE_MISMATCH',
  'PUBLICATION_RELEASE_UNREACHABLE',
  'PUBLICATION_VERSION_INVALID',
]

export type RegistryErrorCode = (typeof REGISTRY_ERROR_CODES)[number]

export declare class RegistryError extends AstraleError {
  constructor(
    code: RegistryErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  )
  readonly details?: Readonly<Record<string, unknown>>
}

export interface AdminRegistryContext {
  readonly session: Pick<ClientSession, 'call'> & {
    readonly content: Pick<ContentApi, 'download'>
  }
  readonly graph: AdminGraphQueryApi
}

export interface AdminRegistryApi {
  index(origin: string): Promise<RegistryIndexV1>
  bundle(origin: string, version: string, output: string): Promise<RegistryBundleV1>
  publish(request: PublishRequestV1): Promise<PublishResultV1>
  yank(
    origin: string,
    version: string,
    options?: { readonly undo?: boolean },
  ): Promise<YankResultV1>
}

export function connectAdminRegistry(context: AdminRegistryContext): AdminRegistryApi
export function publishRequest(input: unknown): PublishRequestV1
export function exactPublicationReference(input: string): {
  readonly origin: string
  readonly version: string
}
export function publicationVersion(input: unknown, reference?: string): string
export function registryOrigin(input: string): string
export function compareVersions(left: string, right: string): number
