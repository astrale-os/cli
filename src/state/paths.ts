import { homedir } from 'node:os'
import { join } from 'node:path'

export interface PathEnvironment {
  readonly ASTRALE_HOME?: string
  readonly ASTRALE_KEYS_DIR?: string
  readonly ASTRALE_DATA_DIR?: string
}

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

/** Resolve every CLI state path once from explicit input and the captured environment. */
export function createPaths(home?: string, environment?: PathEnvironment): Paths {
  const captured = environment ?? {
    ASTRALE_HOME: process.env.ASTRALE_HOME,
    ASTRALE_KEYS_DIR: process.env.ASTRALE_KEYS_DIR,
    ASTRALE_DATA_DIR: process.env.ASTRALE_DATA_DIR,
  }
  const base = home ?? captured.ASTRALE_HOME ?? join(homedir(), '.astrale')
  const idpsDir = join(base, 'idps')
  const idpSessionsDir = join(base, 'idp-sessions')
  return Object.freeze({
    home: base,
    keys: captured.ASTRALE_KEYS_DIR ?? join(base, 'keys'),
    data: captured.ASTRALE_DATA_DIR ?? join(base, 'data'),
    config: join(base, 'config.json'),
    install: join(base, 'install.json'),
    identities: join(base, 'identities.json'),
    instances: join(base, 'instances.json'),
    idps: join(idpsDir, 'index.json'),
    idpSessionsDir,
    exchangeCredentials: join(base, 'exchange', 'credentials.json'),
    sessionRoutes: join(base, 'session', 'routes.json'),
    idpDir: (name: string) => join(idpsDir, name),
    idpSession: (identityName: string) => join(idpSessionsDir, `${identityName}.json`),
  })
}

export const paths: Paths = createPaths()
export const ASTRALE_HOME = paths.home
export const KEYS_DIR = paths.keys
export const DATA_DIR = paths.data
export const CONFIG_PATH = paths.config
export const INSTALL_PATH = paths.install
export const IDENTITIES_PATH = paths.identities
export const INSTANCES_PATH = paths.instances
export const IDPS_PATH = paths.idps
export const IDP_SESSIONS_DIR = paths.idpSessionsDir
export const EXCHANGE_CREDENTIALS_PATH = paths.exchangeCredentials
export const SESSION_ROUTES_PATH = paths.sessionRoutes
