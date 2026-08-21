/**
 * workspace-state.ts — process-global workspace context shared by the entrypoint
 * (index.ts), the live watcher (workspace-watch.ts), and the create-domain
 * endpoint (workspace/create.ts): the scanned ROOT (where new domains are
 * scaffolded), the schema-dir name, and the `domainId → file-watcher stop` map.
 *
 * It exists so the create endpoint can scaffold into the same root the studio
 * watches — and re-boot the freshly-created domain — without index.ts having to
 * thread those values through the API signature.
 */

const state = { root: '', schemaDirName: 'schema' }

/** domainId → stop its file watcher. The startup scan + the live watcher + the
 *  create endpoint all share this one map so "what domains are live" stays single-sourced. */
export const stoppers = new Map<string, () => void>()

/** Called once at boot with the resolved workspace root + schema-dir name. */
export function initWorkspaceState(root: string, schemaDirName: string): void {
  state.root = root
  state.schemaDirName = schemaDirName
}

/** The directory the studio scans for domains — where `create new` scaffolds a sibling. */
export const workspaceRoot = (): string => state.root
export const workspaceSchemaDirName = (): string => state.schemaDirName
