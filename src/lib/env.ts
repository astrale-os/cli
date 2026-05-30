import { homedir } from 'node:os'
import { join } from 'node:path'

export type Paths = {
  home: string
  keys: string
  logs: string
  data: string
  config: string
  compose: string
  managerPid: string
  identities: string
  instances: string
  managerCache: string
  tunnels: string
  tunnelsDir: string
  journal: string
  domainsDir: string
  /** Per-domain state dir: `~/.astrale/domains/<slug>/`. */
  domainStateDir: (slug: string) => string
  /** Per-domain `devUp`/`devDown` state file. */
  domainState: (slug: string) => string
  /** Per-domain dev log dir (wrangler.log, tunnel logs…). */
  domainLogDir: (slug: string) => string
}

/**
 * Resolve the Astrale home dir.
 *
 * Priority: `ASTRALE_HOME` env var (set by the container entrypoint) →
 * explicit arg → `$HOME/.astrale`. The env override exists because inside
 * the `manager` container the process UID has no `/etc/passwd` entry, so
 * `os.homedir()` falls back to `/` — which produces `/.astrale` (root FS,
 * not writable). The container sets `ASTRALE_HOME=/astrale` to match the
 * bind-mounted layout.
 */
function resolveHome(home?: string): string {
  return home ?? process.env.ASTRALE_HOME ?? join(homedir(), '.astrale')
}

export function createPaths(home?: string): Paths {
  const base = resolveHome(home)
  const domainsDir = join(base, 'domains')
  const logsDir = process.env.ASTRALE_LOGS_DIR ?? join(base, 'logs')
  return {
    home: base,
    keys: process.env.ASTRALE_KEYS_DIR ?? join(base, 'keys'),
    logs: logsDir,
    data: process.env.ASTRALE_DATA_DIR ?? join(base, 'data'),
    config: join(base, 'config.json'),
    compose: join(base, 'docker-compose.yml'),
    managerPid: join(base, 'manager.pid'),
    identities: join(base, 'identities.json'),
    instances: join(base, 'instances.json'),
    managerCache: join(base, 'manager-cache.json'),
    tunnels: join(base, 'tunnels.json'),
    tunnelsDir: join(base, 'tunnels'),
    journal: join(logsDir, 'events.ndjson'),
    domainsDir,
    domainStateDir: (slug: string) => join(domainsDir, slug),
    domainState: (slug: string) => join(domainsDir, slug, 'state.json'),
    domainLogDir: (slug: string) => join(domainsDir, slug, 'logs'),
  }
}

/** Default singleton used by all lib modules. */
export const paths: Paths = createPaths()

/** True when the CLI is running inside the `manager` docker-compose service. */
export function isInContainer(): boolean {
  return process.env.ASTRALE_IN_CONTAINER === '1'
}

/** Parse a positive-integer env var; throws with a clear label if malformed. */
export function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name}="${raw}" is not a valid positive integer`)
  }
  return n
}
