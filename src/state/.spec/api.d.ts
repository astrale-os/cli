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

/** Atomically replace one private CLI state file through a same-directory temporary file. */
export function atomicWrite(path: string, data: string): Promise<void>

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
