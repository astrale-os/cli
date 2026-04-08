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
  uiPid: string
  identities: string
  instances: string
  journal: string
}

export function createPaths(home?: string): Paths {
  const base = home ?? join(homedir(), '.astrale')
  return {
    home: base,
    keys: join(base, 'keys'),
    logs: join(base, 'logs'),
    data: join(base, 'data'),
    config: join(base, 'config.json'),
    compose: join(base, 'docker-compose.yml'),
    managerPid: join(base, 'manager.pid'),
    uiPid: join(base, 'ui.pid'),
    identities: join(base, 'identities.json'),
    instances: join(base, 'instances.json'),
    journal: join(base, 'logs', 'events.ndjson'),
  }
}

/** Default singleton used by all lib modules. */
export const paths: Paths = createPaths()
