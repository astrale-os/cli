import type { Authentication, RegisterRequest } from '@astrale-os/sdk/auth'
import type { Call } from '@astrale-os/sdk/client'
import type { NodeId } from '@astrale-os/sdk/graph/node'
import type { JWK } from 'jose'

import type {
  Identity,
  IdentityMode,
  IdentityStore,
  IdentityStoreOptions,
  Registration,
} from '../../state/.spec/api.js'

export type { Identity, IdentityStore, Registration } from '../../state/.spec/api.js'

/** Filesystem coordinates used only by explicit identity transfer operations. */
export interface IdentityFileOptions {
  readonly state?: IdentityStoreOptions
  readonly keysDir?: string
}

/** Canonical V1 key-identity transfer envelope. */
export interface IdentityExport {
  readonly version: 1
  readonly subject: string
  readonly mode: IdentityMode
  readonly kid?: string
  readonly issuer?: string
  readonly privateJwk: JWK
  readonly publicJwk: JWK
}

export interface IdentityImportOptions extends IdentityFileOptions {
  readonly name?: string
  readonly issuer?: string
  readonly replace?: boolean
}

export interface IdentityRegistrationResult {
  readonly iss: string
  readonly sub: string
  readonly nodeId?: string
}

/** An admitted registration response identifies the selected existing Node. */
export interface RegisteredIdentity extends IdentityRegistrationResult {
  readonly nodeId: string
}

export interface IdentityRegistrationSubmission {
  readonly request: RegisterRequest
  readonly nodeId: NodeId
  readonly expectedAuthentication: Authentication
  readonly via?: string
  readonly direct: {
    register(request: RegisterRequest): Promise<unknown>
  }
  readonly callable: {
    call(call: Call): Promise<unknown>
  }
}

/** Submit one prepared request either directly or through its explicit Domain authority owner. */
export function submitIdentityRegistration(
  input: IdentityRegistrationSubmission,
): Promise<RegisteredIdentity>

/** Admit only the selected existing Node; remote callables remain untrusted input. */
export function acceptRegisteredIdentity(
  value: unknown,
  nodeId: NodeId,
  expectedAuthentication: Authentication,
): RegisteredIdentity

export function readIdentities(): Promise<IdentityStore>

export function createIdentity(
  name: string,
  options?: {
    readonly subject?: string
    readonly mode?: IdentityMode
    readonly issuer?: string
    readonly kid?: string
  },
): Promise<Identity>

export function deleteIdentity(name: string): Promise<void>
export function setDefault(name: string): Promise<void>
export function getDefault(): Promise<Identity & { readonly name: string }>
export function getIdentity(name: string): Promise<Identity>

export function upsertIdpIdentity(
  name: string,
  options: {
    readonly subject: string
    readonly idp: string
    readonly issuer: string
    readonly audience?: string
    readonly claims?: Readonly<Record<string, unknown>>
    readonly use?: boolean
  },
): Promise<Identity>

export function setRegistration(
  name: string,
  instanceSlug: string,
  registration: Registration,
): Promise<void>

export function setIdentityMode(name: string, mode: IdentityMode): Promise<void>

/** Detect the retained compact-JWE representation without decoding it. */
export function isEncryptedIdentityExport(raw: string): boolean

/** Decode legacy plaintext, V1 plaintext, or compact-JWE content into one admitted V1 envelope. */
export function decodeIdentityExport(raw: string, passphrase?: string): Promise<IdentityExport>

/** Encode one admitted envelope as plaintext JSON or compact JWE. */
export function encodeIdentityExport(envelope: IdentityExport, passphrase?: string): Promise<string>

/** Read and prove one key-backed identity's transferable envelope. */
export function exportIdentity(name: string, options?: IdentityFileOptions): Promise<IdentityExport>

/** Import one admitted envelope after checking registry conflicts but before publishing registry state. */
export function importIdentity(
  envelope: IdentityExport,
  options?: IdentityImportOptions,
): Promise<Identity>

/** Atomically publish one explicit private export file with mode 0600. */
export function writeIdentityExport(path: string, content: string): Promise<void>
