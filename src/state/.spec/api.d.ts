import type { SessionRouteArtifact, SessionRouteStore } from '@astrale-os/sdk/client/session'

/** Environment values that affect CLI-owned state placement. */
export interface PathEnvironment {
  readonly ASTRALE_HOME?: string
  readonly ASTRALE_KEYS_DIR?: string
  readonly ASTRALE_DATA_DIR?: string
}

/** One captured set of CLI-owned durable-state coordinates. */
export interface Paths {
  readonly home: string
  readonly keys: string
  readonly data: string
  readonly config: string
  readonly install: string
  readonly identities: string
  readonly instances: string
  readonly idps: string
  readonly idpSessionsDir: string
  readonly exchangeCredentials: string
  readonly sessionRoutes: string
  idpDir(name: string): string
  idpSession(identityName: string): string
}

/** Resolve explicit home, environment overrides, and platform home exactly once. */
export function createPaths(home?: string, environment?: PathEnvironment): Paths

export const paths: Paths
export const ASTRALE_HOME: string
export const KEYS_DIR: string
export const DATA_DIR: string
export const CONFIG_PATH: string
export const INSTALL_PATH: string
export const IDENTITIES_PATH: string
export const INSTANCES_PATH: string
export const IDPS_PATH: string
export const IDP_SESSIONS_DIR: string
export const EXCHANGE_CREDENTIALS_PATH: string
export const SESSION_ROUTES_PATH: string

export namespace exchange {
  interface Artifact {
    readonly version: 2
    readonly entries: Record<string, Entry>
  }

  interface Key {
    readonly kernelIssuer: string
    readonly domainIssuer: string
    readonly sourceIssuer: string
    readonly sourceSubject: string
  }

  interface Entry {
    readonly credential: string
    readonly expiresAt: number
    readonly user: string
    readonly sourceIssuer: string
    readonly sourceSubject: string
  }
}

/** Persist exact Domain bearer tokens under a private, cross-process synchronized cache. */
export class ExchangeCredentialCache {
  constructor(path?: string)
  getOrRefresh(
    key: exchange.Key,
    refresh: () => Promise<exchange.Entry>,
    now?: () => number,
  ): Promise<string>
  deleteKernel(kernelIssuer: string): Promise<void>
  clear(): Promise<void>
}

export type IdentitySource = 'key' | 'idp'
export type IdentityMode = 'local' | 'remote'

export interface Registration {
  readonly iss: string
  readonly sub: string
  readonly registeredAt: string
}

export interface Identity {
  readonly subject: string
  readonly createdAt: string
  readonly source?: IdentitySource
  readonly mode?: IdentityMode
  readonly kid?: string
  readonly idp?: string
  readonly issuer?: string
  readonly audience?: string
  readonly claims?: Readonly<Record<string, unknown>>
  readonly registrations?: Readonly<Record<string, Registration>>
}

/** Decoded semantic identity state; persistence-version metadata is not exposed to consumers. */
export interface IdentityStore {
  readonly default: string
  readonly identities: Readonly<Record<string, Identity>>
}

export const IDENTITY_STORE_VERSION: 1

export interface IdentityStoreOptions {
  readonly path?: string
  readonly now?: () => Date
  readonly lock?: FileLockOptions
}

export interface IdentityUpdate<Value> {
  readonly next: IdentityStore
  readonly value: Value
}

/** Decode the missing, legacy, or current identity file without writing or migrating it. */
export function readIdentityStore(options?: IdentityStoreOptions): Promise<IdentityStore>

/** Reread and commit one identity transition under the file's cross-process lock. */
export function updateIdentityStore<Value>(
  transition: (current: IdentityStore) => IdentityUpdate<Value> | Promise<IdentityUpdate<Value>>,
  options?: IdentityStoreOptions,
): Promise<Value>

/** Atomically replace one private CLI state file through a same-directory temporary file. */
export function atomicWrite(path: string, data: string): Promise<void>
export function atomicWriteSync(path: string, data: string): void

/** CLI filesystem representation for Kernel Client's admitted confidential route artifact. */
export class FileSessionRouteStore implements SessionRouteStore {
  constructor(path?: string)
  read(): unknown
  write(artifact: SessionRouteArtifact): void
  clear(): void
}

export const SESSION_ROUTE_STORE: Readonly<FileSessionRouteStore>

export interface FileLockOptions {
  readonly pollIntervalMs?: number
  readonly staleAfterMs?: number
  readonly timeoutMs?: number
}

/** Run one state transition under a bounded cross-process file lock. */
export function withFileLock<Value>(
  lockPath: string,
  transition: () => Promise<Value>,
  options?: FileLockOptions,
): Promise<Value>
