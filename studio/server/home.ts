/**
 * home.ts — the Studio's corner of the CLI's home on this machine.
 *
 * Everything the agent layer persists — chat tabs, transcripts, session ids, the bridge
 * grants a turn mints — lives here, NOT in the workspace and NOT in a domain: a
 * conversation is about a workspace, and it should be found again wherever the studio
 * is opened next. The CLI already keeps its instances and view sessions under
 * `~/.astrale`; `ASTRALE_HOME` moves that whole home, tests included.
 */
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

/** The CLI's home: `ASTRALE_HOME`, else `~/.astrale`. */
export function astraleHome(): string {
  const configured = process.env.ASTRALE_HOME?.trim()
  return configured ? resolve(configured) : join(homedir(), '.astrale')
}

/** Where the studio keeps what belongs to the machine rather than to a domain. */
export function studioHome(): string {
  return join(astraleHome(), 'studio')
}

/** Chats, harness session ids and transcripts shared by every Studio workspace. */
export function agentStateRoot(): string {
  return join(studioHome(), 'agent')
}

/**
 * A stable, readable key for one workspace root.
 *
 * The basename says which workspace a folder is about when someone browses the home;
 * the hash keeps two workspaces of the same name apart. Derived from the path, like the
 * harnesses derive their own session folders: a workspace that moves starts over, which
 * is also what its sessions would have done.
 */
export function workspaceKey(root: string): string {
  const abs = resolve(root)
  const hash = createHash('sha1').update(abs).digest('hex').slice(0, 8)
  const name =
    basename(abs)
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(0, 40) || 'workspace'
  return `${name}-${hash}`
}

/** The machine-side UI state folder of one workspace. */
export function workspaceStateRoot(root: string): string {
  return join(studioHome(), 'workspaces', workspaceKey(root))
}

/**
 * Whether a state root IS the machine store. The state gateway adds `.domain-studio`
 * under a domain root, where studio files sit beside the domain's own; under the home
 * there is nothing to keep them apart from, so the root is used as it is.
 */
export function isMachineStateRoot(root: string): boolean {
  const abs = resolve(root)
  const home = resolve(studioHome())
  return abs === home || abs.startsWith(home + sep)
}
