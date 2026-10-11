import type { SessionRouteArtifact, SessionRouteStore } from '@astrale-os/sdk/client/session'

/** One captured set of CLI-owned durable-state coordinates. */
export interface Paths {
  readonly home: string
  readonly keys: string
  readonly config: string
  readonly install: string
  readonly identities: string
  readonly instances: string
  readonly idps: string
  readonly idpSessionsDir: string
  readonly exchangeCredentials: string
  readonly sessionRoutes: string
  readonly installations: string
  idpDir(name: string): string
  idpSession(identityName: string): string
}

/** Resolve every CLI state path from ASTRALE_HOME, ASTRALE_KEYS_DIR, or the platform home. */
export function createPaths(): Paths

export const paths: Paths
export const ASTRALE_HOME: string
export const KEYS_DIR: string
export const CONFIG_PATH: string
export const INSTALL_PATH: string
export const INSTANCES_PATH: string
export const IDPS_PATH: string
export const IDP_SESSIONS_DIR: string
export const EXCHANGE_CREDENTIALS_PATH: string

/**
 * What the CLI remembers about one Domain installed on one Kernel. Only facts whose staleness fails
 * closed belong here (a moved issuer fails at token exchange or Kernel admission, and its reader
 * forgets it); facts an upgrade changes without failing need revalidation and never live here.
 */
export interface Installation {
  /** Issuer the installed pin named when read, or null when the Domain executes on the Kernel. */
  readonly issuer: string | null
}

/** Remember each Domain installation per source Kernel; installation state, never authority. */
/**
 * A record is trusted only while the cache can still forget it: without a writable directory every
 * record is a miss, and a record that cannot be rewritten away is removed with the whole file.
 */
export class InstallationCache {
  constructor(path?: string, maximumAgeMs?: number, lock?: FileLockOptions)
  get(kernelIssuer: string, origin: string, now?: number): Promise<Installation | undefined>
  set(kernelIssuer: string, origin: string, installation: Installation, now?: number): Promise<void>
  delete(kernelIssuer: string, origin: string): Promise<void>
  deleteKernel(kernelIssuer: string): Promise<void>
}

export const INSTALLATION_CACHE: InstallationCache

interface ExchangeKey {
  readonly kernelIssuer: string
  readonly domainIssuer: string
  readonly sourceIssuer: string
  readonly sourceSubject: string
}

interface ExchangeEntry {
  readonly credential: string
  readonly expiresAt: number
  readonly user: string
  readonly sourceIssuer: string
  readonly sourceSubject: string
}

/** Persist exact Domain bearer tokens under a private, cross-process synchronized cache. */
export class ExchangeCredentialCache {
  constructor(path?: string)
  get(
    key: ExchangeKey,
    minimumRemainingSeconds: number,
    now?: () => number,
  ): Promise<string | undefined>
  getOrRefresh(
    key: ExchangeKey,
    minimumRemainingSeconds: number,
    refresh: () => Promise<ExchangeEntry>,
    now?: () => number,
  ): Promise<string>
  deleteKernel(kernelIssuer: string): Promise<void>
  clear(): Promise<void>
}

export type IdentityMode = 'local' | 'remote'

/** Decoded from the strict V1 zod schema of `identities.json`. */
export interface Registration {
  readonly iss: string
  readonly sub: string
  readonly registeredAt: string
}

export interface Identity {
  readonly subject: string
  readonly createdAt: string
  readonly source?: 'key' | 'idp'
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

interface IdentityUpdate<Value> {
  readonly next: IdentityStore
  readonly value: Value
}

/** Decode missing or V1 identity state without writing it; refuse unversioned and unsupported files. */
export function readIdentityStore(options?: IdentityStoreOptions): Promise<IdentityStore>

/** Reread and commit one identity transition under the file's cross-process lock. */
export function updateIdentityStore<Value>(
  transition: (current: IdentityStore) => IdentityUpdate<Value> | Promise<IdentityUpdate<Value>>,
  options?: IdentityStoreOptions,
): Promise<Value>

/** Atomically replace one private CLI state file through a same-directory temporary file. */
export function atomicWrite(path: string, data: string): Promise<void>
export function atomicWriteSync(path: string, data: string | Uint8Array): void

/** Read-modify-write one owner-private `{ version, entries }` store under its file lock. */
export function updatePrivateStore<Entry, Value>(
  path: string,
  version: number,
  transition: (
    entries: Record<string, Entry>,
  ) => Promise<{ readonly value: Value; readonly changed: boolean }>,
  options?: FileLockOptions,
): Promise<Value>

/** The entries of an owner-private store; a missing, unreadable or other-version store is empty. */
export function readPrivateStore<Entry>(
  path: string,
  version: number,
): Promise<Record<string, Entry>>

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
