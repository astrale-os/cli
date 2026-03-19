import { homedir } from 'node:os'
import { join } from 'node:path'

export const ASTRALE_HOME = join(homedir(), '.astrale')
export const KEYS_DIR = join(ASTRALE_HOME, 'keys')
export const LOGS_DIR = join(ASTRALE_HOME, 'logs')
export const DATA_DIR = join(ASTRALE_HOME, 'data')
export const CONFIG_PATH = join(ASTRALE_HOME, 'config.json')
export const COMPOSE_PATH = join(ASTRALE_HOME, 'docker-compose.yml')
export const MANAGER_PID_PATH = join(ASTRALE_HOME, 'manager.pid')
export const UI_PID_PATH = join(ASTRALE_HOME, 'ui.pid')
export const IDENTITIES_PATH = join(ASTRALE_HOME, 'identities.json')
export const TARGETS_PATH = join(ASTRALE_HOME, 'targets.json')
export const JOURNAL_PATH = join(ASTRALE_HOME, 'logs', 'events.ndjson')
