/**
 * Scaffold a brand-new domain into the workspace and bring it
 * online. This is the studio's ONE write that ADDS a domain (every other state
 * module operates on an existing one).
 *
 * Flow: validate the slug → `create-astrale-domain <slug> --yes` in the
 * workspace root (the managed `astrale` adapter is its default; we stamp the
 * active instance so prod targets it) → `pnpm install` in the new dir so the
 * domain is fully introspectable + deployable → register + (re)boot it (the live
 * watcher may have already booted a deps-less static fallback while we were
 * installing; we stop that and boot fresh) → warm its bundle. The caller
 * broadcasts the `workspace` event so every client refetches the domain list.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getBundle } from '../cache'
import { registerDomain } from '../domain'
import { findSchemaDefinition } from '../introspect/anatomy-extras'
import { bootDomain } from '../lifecycle'
import { stoppers, workspaceRoot } from '../workspace-state'

/** Mirrors create-astrale-domain's `isValidSlug`: lowercase letters, digits, dots, dashes;
 *  must start/end alphanumeric. Also guards the filesystem target (no `/`, no `..`, no leading dot). */
const SLUG = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

export interface CreateDomainResult {
  ok: boolean
  id?: string
  origin?: string
  error?: string
  output: string
}

async function run(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; output: string }> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    })
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    return { code, output: `${out}\n${err}`.trim() }
  } catch (e) {
    return { code: 1, output: `failed to spawn ${cmd}: ${(e as Error)?.message ?? e}` }
  }
}

export async function createDomain(
  rawName: string,
  instance: string | null,
): Promise<CreateDomainResult> {
  const name = rawName.trim().toLowerCase()
  if (!name || name.length > 64 || !SLUG.test(name)) {
    return {
      ok: false,
      error: 'Use lowercase letters, digits, dots and dashes (e.g. “crm” or “crm.acme.dev”).',
      output: '',
    }
  }
  const root = workspaceRoot()
  if (!root) return { ok: false, error: 'No workspace root is configured.', output: '' }
  const dir = join(root, name)
  if (existsSync(dir)) {
    return {
      ok: false,
      error: `A folder named “${name}” already exists in the workspace.`,
      output: '',
    }
  }

  // 1. Scaffold (non-interactive). `--yes` accepts defaults (astrale adapter, template);
  //    `--instance` stamps the active instance into the managed prod target.
  const scaffoldArgs = [
    '--yes',
    'create-astrale-domain@latest',
    name,
    '--yes',
    ...(instance ? ['--instance', instance] : []),
  ]
  const scaffold = await run('npx', scaffoldArgs, root)
  const scaffolded = registerDomain(dir)
  if (!scaffolded) {
    return {
      ok: false,
      error:
        'Scaffolding did not produce a domain with an Application schema binding. See the log.',
      output: scaffold.output.slice(-6000),
    }
  }

  // 1b. Flag the placeholder origin for the agent (we ask for the name only, so the
  //     origin is `<name>.example.dev` until someone — or the agent — sets the real one).
  annotateOrigin(dir, scaffolded.schemaDirName)

  // 2. Install deps so the domain is fully introspectable + deployable. Best-effort:
  //    a scaffolded-but-uninstalled domain still loads (static fallback), so a failed
  //    install is a soft warning, not a hard failure.
  const install = await run('pnpm', ['install'], dir)

  // 3. Register + boot with deps present. The live watcher may have already booted a
  //    deps-less fallback for this dir mid-install — stop it and boot fresh.
  const handle = registerDomain(dir)
  if (!handle) {
    return {
      ok: false,
      error: 'Scaffold incomplete — config or Application schema binding is missing.',
      output: combine(scaffold, install),
    }
  }
  stoppers.get(handle.id)?.()
  const { origin } = await bootDomain(handle).then((b) => {
    stoppers.set(handle.id, b.stop)
    return b
  })
  await getBundle(handle.id, true) // refresh the cache now that deps are installed

  return { ok: true, id: handle.id, origin, output: combine(scaffold, install) }
}

function combine(a: { output: string }, b: { output: string }): string {
  return `$ create-astrale-domain\n${a.output}\n\n$ pnpm install\n${b.output}`.trim().slice(-6000)
}

/**
 * Drop an agent-actionable marker on the origin line of the scaffolded schema.
 * The public schema/index.ts is now commonly a barrel, so the definition is
 * located statically below it. We only ask for the NAME, so the origin starts as the
 * `<name>.example.dev` placeholder — this comment tells a human (or the studio's
 * agent) it's a placeholder to change, and that the studio re-parses the literal
 * as the source of truth so the rename takes effect on save. Best-effort: the
 * template already explains the origin, so a parse miss is harmless.
 */
export function annotateOrigin(dir: string, schemaDirName = 'schema'): void {
  const definition = findSchemaDefinition(dir, schemaDirName)
  if (!definition) return
  const file = definition.file
  try {
    const src = readFileSync(file, 'utf8')
    if (src.includes('ORIGIN —')) return // already annotated (idempotent)
    const lines = src.split('\n')
    const index = Math.max(0, definition.line - 1)
    const pad = lines[index]?.match(/^[ \t]*/)?.[0] ?? ''
    const note =
      `${pad}// ORIGIN — the domain's permanent identity in the graph. It was set from the name as a\n` +
      `${pad}// PLACEHOLDER; change the literal or constant used here (e.g. to "crm.acme.dev"), ideally BEFORE\n` +
      `${pad}// the first deploy (the origin is hard to change once installed). The studio parses this\n` +
      `${pad}// schema statically as the source of truth, so the rename refreshes on save.\n`
    lines.splice(index, 0, note.trimEnd())
    writeFileSync(file, lines.join('\n'))
  } catch {
    /* best-effort */
  }
}
