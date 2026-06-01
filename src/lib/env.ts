import { homedir } from 'node:os'
import { join } from 'node:path'

export type Paths = {
  home: string
  keys: string
  data: string
  config: string
  identities: string
  instances: string
  idps: string
  idpSessionsDir: string
  /** Per-IdP config dir: `~/.astrale/idps/<name>/`. */
  idpDir: (name: string) => string
  /** Per-identity IdP session cache: `~/.astrale/idp-sessions/<name>.json`. */
  idpSession: (identityName: string) => string
}

/**
 * Resolve the Astrale home dir.
 *
 * Priority: explicit arg → `ASTRALE_HOME` env var → `$HOME/.astrale`.
 */
function resolveHome(home?: string): string {
  return home ?? process.env.ASTRALE_HOME ?? join(homedir(), '.astrale')
}

export function createPaths(home?: string): Paths {
  const base = resolveHome(home)
  const idpsDir = join(base, 'idps')
  const idpSessionsDir = join(base, 'idp-sessions')
  return {
    home: base,
    keys: process.env.ASTRALE_KEYS_DIR ?? join(base, 'keys'),
    data: process.env.ASTRALE_DATA_DIR ?? join(base, 'data'),
    config: join(base, 'config.json'),
    identities: join(base, 'identities.json'),
    instances: join(base, 'instances.json'),
    idps: join(idpsDir, 'index.json'),
    idpSessionsDir,
    idpDir: (name: string) => join(idpsDir, name),
    idpSession: (identityName: string) => join(idpSessionsDir, `${identityName}.json`),
  }
}

/** Default singleton used by all lib modules. */
export const paths: Paths = createPaths()
