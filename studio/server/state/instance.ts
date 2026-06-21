/**
 * state/instance.ts — the deploy/install bridge to Astrale.
 *
 * The ACTIVE instance is GLOBAL (not per-domain) and the `astrale` CLI owns it —
 * we never keep our own copy: `listInstances` reads `astrale instance list`,
 * `setActiveInstance` runs `astrale instance use`. Install + drift are GROUND
 * TRUTH, queried from the target instance (`astrale get /<origin>`) — NOT a local
 * record — so a deploy done outside the studio (CLI/terminal) is still seen.
 *
 * Deploy (`pnpm prod`) = the managed astrale adapter: deploy + auto-install on
 * the configured instance; we capture the printed service URL.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type {
  DeployRecord,
  DeployResult,
  InstanceInfo,
  InstanceStatus,
  InstancesState,
} from '../../shared/types'
import type { DomainHandle } from '../domain'

import { schemaHashOf } from '../introspect/hash'
import { readJson, writeJson } from './store'

const DEPLOY_REC = 'deploy.json'

function hasProdScript(root: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    return typeof pkg?.scripts?.prod === 'string'
  } catch {
    return false
  }
}

async function astraleJson(args: string[]): Promise<any | null> {
  try {
    const proc = Bun.spawn(['astrale', ...args], { stdout: 'pipe', stderr: 'ignore' })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    return JSON.parse(out)
  } catch {
    return null
  }
}

// ── global: the CLI's instances (source of truth = `astrale instance ...`) ──

/** The active instance name — from `astrale instance active` (local, reliable). */
async function activeName(): Promise<string | null> {
  const a = await astraleJson(['instance', 'active', '--json'])
  return a?.name ?? null
}

/** Public wrapper — the create-domain endpoint stamps this as `--instance` on the scaffold. */
export const activeInstanceName = activeName

export async function listInstances(): Promise<InstancesState> {
  // The plain `instance list` fetches signing keys for EVERY bookmark, so one
  // unreachable bookmark (e.g. a stopped localhost kernel) errors out the whole
  // command. `--bookmarked` is local-only (reliable); `--admin-only` adds the
  // managed instances best-effort (skipped if the admin call is unavailable).
  const local = await astraleJson(['instance', 'list', '--bookmarked', '--json'])
  const active: string | null = local?.active ?? (await activeName())
  const instances: InstanceInfo[] = []
  for (const b of local?.bookmarks ?? []) {
    instances.push({
      name: b.name,
      url: b.url ?? '',
      active: !!b.active || b.name === active,
      kind: 'bookmark',
    })
  }
  const managed = await astraleJson(['instance', 'list', '--admin-only', '--json'])
  for (const m of managed?.instances ?? []) {
    if (!m.slug || instances.some((i) => i.name === m.slug)) continue
    instances.push({ name: m.slug, url: m.url ?? '', active: m.slug === active, kind: 'managed' })
  }
  if (active && !instances.some((i) => i.name === active)) {
    instances.unshift({ name: active, url: '', active: true, kind: 'bookmark' })
  }
  return { active, instances }
}

export async function setActiveInstance(
  name: string,
): Promise<{ ok: boolean; active: string | null; output: string }> {
  try {
    // --adopt-default: never block on an interactive identity prompt;
    // --skip-jwks-check: don't do a network /meta↔JWKS check (which fails for an
    // unreachable bookmark like a stopped localhost kernel). Switching is then a
    // deterministic local write to instances.json.
    const proc = Bun.spawn(
      ['astrale', 'instance', 'use', name, '--adopt-default', '--skip-jwks-check'],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    const combined = `${out}\n${err}`.trim()
    if (code !== 0) return { ok: false, active: await activeName(), output: combined.slice(-1000) }
    return { ok: true, active: await activeName(), output: combined.slice(-1000) }
  } catch (e: any) {
    return { ok: false, active: null, output: String(e?.message ?? e) }
  }
}

// ── per-domain: deploy target + GROUND-TRUTH install/drift (queried from the instance) ──

export function lastDeploy(root: string): DeployRecord | null {
  return readJson<DeployRecord | null>(root, DEPLOY_REC, null)
}

/**
 * Ask the target instance for the domain node (`astrale get /<origin> -i <instance>`).
 * Installed ⇒ the kernel returns the Domain node (with the installed schema in
 * `props.schema`); `NOT_FOUND` ⇒ not installed; anything else (offline / not
 * authed / unknown instance) ⇒ unknown (never falsely "not installed").
 */
async function getInstalledDomain(
  origin: string,
  instance: string,
  timeoutMs = 8000,
): Promise<{ state: 'installed' | 'not-installed' | 'unknown'; schema: unknown | null }> {
  try {
    const proc = Bun.spawn(['astrale', 'get', `/${origin}`, '-i', instance, '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* already exited */
      }
    }, timeoutMs)
    try {
      const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      await proc.exited
      let parsed: any = null
      try {
        parsed = JSON.parse(out)
      } catch {
        /* non-JSON */
      }
      if (parsed?.error === 'NOT_FOUND' || /\bNOT_FOUND\b/.test(`${out}\n${err}`))
        return { state: 'not-installed', schema: null }
      if (parsed?.path && parsed?.props) {
        let schema: unknown = null
        try {
          schema = parsed.props.schema ? JSON.parse(parsed.props.schema) : null
        } catch {
          /* schema absent/unparseable — still installed */
        }
        return { state: 'installed', schema }
      }
      return { state: 'unknown', schema: null }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return { state: 'unknown', schema: null }
  }
}

export async function instanceStatus(
  handle: DomainHandle,
  deployTarget: string | null,
  origin: string | null,
  localHash: string | null,
): Promise<InstanceStatus> {
  const deployable = hasProdScript(handle.root)
  const last = lastDeploy(handle.root)
  let install: InstanceStatus['install'] = 'unknown'
  let installedHash: string | null = null
  let drift: InstanceStatus['drift'] = 'unknown'

  if (origin && deployTarget) {
    const probe = await getInstalledDomain(origin, deployTarget)
    if (probe.state === 'installed') {
      install = 'installed'
      installedHash = probe.schema ? schemaHashOf(probe.schema) : null
      drift =
        installedHash && localHash
          ? installedHash === localHash
            ? 'in-sync'
            : 'drifted'
          : 'unknown'
    } else if (probe.state === 'not-installed') {
      install = 'not-installed'
    }
  }

  return { deployTarget, deployable, install, drift, localHash, installedHash, lastDeploy: last }
}

const SVC_URL = /https:\/\/[\w-]+\.svc\.[\w.-]+\.astrale\.ai\b/

/** Run `pnpm prod` (deploy + managed auto-install). Outward-facing — only call on an explicit request. */
export async function runDeploy(
  handle: DomainHandle,
  localHash: string | null,
): Promise<DeployResult> {
  if (!hasProdScript(handle.root)) {
    return {
      ok: false,
      url: null,
      output:
        'This domain has no "prod" script in package.json — it is not deployable via `pnpm prod`.',
    }
  }
  let out = ''
  let err = ''
  let code = 1
  try {
    const proc = Bun.spawn(['pnpm', 'prod'], { cwd: handle.root, stdout: 'pipe', stderr: 'pipe' })
    ;[out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    code = await proc.exited
  } catch (e: any) {
    return { ok: false, url: null, output: `failed to start pnpm: ${e?.message ?? e}` }
  }
  const combined = `${out}\n${err}`.trim()
  const url = combined.match(SVC_URL)?.[0] ?? null
  const ok = code === 0
  if (ok)
    writeJson(handle.root, DEPLOY_REC, {
      at: new Date().toISOString(),
      schemaHash: localHash ?? '',
      ok: true,
      url: url ?? undefined,
    } satisfies DeployRecord)
  return { ok, url, output: combined.slice(-6000) }
}
