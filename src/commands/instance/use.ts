import type { OwnedInstanceInfo } from '../../lib/admin-instance'
import type { CommandDefinition } from '../../program/index'

import { AstraleError } from '../../errors'
import { getDefault, setDefault } from '../../identity/index'
import { listOwnedInstances } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { fetchWithCaFile } from '../../lib/ca-fetch'
import {
  findBookmarkTrustConflicts,
  getActive,
  readInstances,
  resolveInstance,
  resolveInstanceKey,
  setActive,
  upsertManagedBookmark,
  type ResolvedInstance,
} from '../../lib/instance'
import {
  collectInstanceCandidates,
  describeInstanceCandidate,
  type InstanceCandidate,
} from '../../lib/instance-candidates'
import { fatal, log } from '../../lib/log'
import { checkIssuerReachability } from '../../lib/meta'
import { confirmDefaultYes, selectFrom } from '../../lib/prompt'
import { validateSlug } from '../../lib/validation'

type UseOpts = {
  admin?: string
  adminUrl?: string
  url?: string
  timeout?: string
  as?: string
  creds?: string
  debug?: boolean
  ci?: boolean
  noPrompt?: boolean
  adoptDefault?: boolean
  skipJwksCheck?: boolean
}

async function useInstance(name?: string, opts: UseOpts = {}): Promise<void> {
  try {
    if (!name) {
      const active = await getActive()
      console.log(`${active.name} (${active.url})`)
      return
    }

    const resolved = await resolveUseTarget(name, opts)

    if (!opts.skipJwksCheck) {
      await probeBookmark(resolved)
    }

    await setActive(resolved.name)
    log.success(`Active instance: ${resolved.name} (${resolved.url})`)

    // §7.1 identity-adoption prompt (DX). Orthogonality preserved — we
    // only switch on explicit user consent (or --adopt-default in CI).
    const store = await readInstances()
    const key = resolveInstanceKey(store, resolved.name)
    const identityCandidate =
      resolved.defaultIdentity ?? (key ? store.instances[key]?.defaultIdentity : undefined)
    if (!identityCandidate) return
    const active = await getDefault().catch(() => null)
    if (active?.name === identityCandidate) return

    const inCi = opts.ci || opts.noPrompt || !!process.env.CI
    if (inCi) {
      if (opts.adoptDefault) {
        await setDefault(identityCandidate)
        log.success(`Identity switched to "${identityCandidate}" (--adopt-default)`)
      } else {
        log.dim(
          `  (instance default identity "${identityCandidate}" — keep active ${active?.name ?? 'none'})`,
        )
      }
      return
    }

    const msg = `Instance "${resolved.name}" has default identity "${identityCandidate}". Active: "${active?.name ?? 'none'}". Switch identity too?`
    if (await confirmDefaultYes(msg)) {
      await setDefault(identityCandidate)
      log.success(`Identity switched to "${identityCandidate}"`)
    } else {
      log.dim('  kept active identity (orthogonal)')
    }
  } catch (e) {
    fatal(e)
  }
}

/** Probe with the exact TLS trust configuration stored on this bookmark. */
export async function probeBookmark(
  resolved: ResolvedInstance,
  dependencies: Partial<BookmarkProbeDependencies> = {},
): Promise<void> {
  const probe = { ...defaultBookmarkProbeDependencies, ...dependencies }
  const store = await probe.readInstances()
  const conflicts = findBookmarkTrustConflicts(store, resolved.name, resolved.url, resolved.caFile)
  try {
    await probe.checkIssuerReachability(
      resolved.url,
      resolved.issuer,
      resolved.caFile ? probe.fetchWithCaFile(resolved.caFile) : undefined,
    )
  } catch (cause) {
    const original = cause instanceof AstraleError ? cause.hint : undefined
    const trust = resolved.caFile
      ? `Bookmark "${resolved.name}" trusts CA ${resolved.caFile}.`
      : `Bookmark "${resolved.name}" uses the system trust store.`
    const collision =
      conflicts.length === 0
        ? ''
        : ` The same URL is bookmarked with different TLS trust as ${conflicts
            .map((conflict) =>
              conflict.caFile
                ? `"${conflict.name}" (CA ${conflict.caFile})`
                : `"${conflict.name}" (system trust)`,
            )
            .join(', ')}.`
    throw new AstraleError(
      cause instanceof AstraleError ? cause.code : 'ISSUER_UNREACHABLE',
      `Issuer/JWKS probe failed for bookmark "${resolved.name}" at ${resolved.url}.`,
      `${trust}${collision}${original ? ` ${original}` : ''} Inspect with \`astrale instance list --bookmarked --json\`.`,
    )
  }
}

interface BookmarkProbeDependencies {
  readonly readInstances: typeof readInstances
  readonly checkIssuerReachability: typeof checkIssuerReachability
  readonly fetchWithCaFile: typeof fetchWithCaFile
}

const defaultBookmarkProbeDependencies: BookmarkProbeDependencies = Object.freeze({
  readInstances,
  checkIssuerReachability,
  fetchWithCaFile,
})

async function resolveUseTarget(name: string, opts: UseOpts): Promise<ResolvedInstance> {
  const [store, managed] = await Promise.all([readInstances(), fetchManagedInstances(name, opts)])
  const candidates = collectInstanceCandidates(name, store, managed)

  if (candidates.length === 0) {
    throw new AstraleError(
      'INSTANCE_NOT_FOUND',
      `Instance "${name}" is not bookmarked and not admin-managed.\n` +
        `  Bookmark: astrale instance bookmark ${name} --url <url>\n` +
        `  Or check: astrale instance list`,
    )
  }

  const interactive = !(opts.ci || opts.noPrompt || process.env.CI)
  const chosen =
    candidates.length === 1
      ? candidates[0]
      : interactive
        ? await pickCandidate(name, candidates)
        : null
  if (!chosen) throw ambiguousError(name, candidates)

  if (chosen.source === 'bookmark') {
    return await resolveInstance(chosen.key)
  }

  assertManagedReady(chosen.info)
  const { repointedFrom } = await upsertManagedBookmark(
    chosen.key,
    chosen.info.slug,
    chosen.url,
    chosen.info.organizationId,
  )
  if (repointedFrom) {
    log.warn(`Bookmark "${chosen.key}" repointed: ${repointedFrom} → ${chosen.url}`)
  }
  return await resolveInstance(chosen.key)
}

/**
 * All admin-managed instances (collectInstanceCandidates filters by name).
 * Best-effort: an unreachable or unauthenticated admin kernel degrades to
 * bookmark-only resolution.
 */
async function fetchManagedInstances(name: string, opts: UseOpts): Promise<OwnedInstanceInfo[]> {
  try {
    validateSlug(name)
  } catch {
    return []
  }
  try {
    return await listOwnedInstances(opts)
  } catch {
    return []
  }
}

function assertManagedReady(info: OwnedInstanceInfo): void {
  if (info.state === 'ready') return
  const detail = info.phase && info.phase !== info.state ? ` (${info.phase})` : ''
  throw new AstraleError(
    'INSTANCE_NOT_READY',
    `Instance "${info.slug}" is ${info.state}${detail}; it cannot be selected yet.`,
    info.error ?? `Run: astrale instance status ${info.slug}`,
  )
}

async function pickCandidate(
  name: string,
  candidates: InstanceCandidate[],
): Promise<InstanceCandidate | null> {
  return selectFrom(
    `Multiple instances match "${name}":`,
    candidates.map((candidate) => ({
      label: describeInstanceCandidate(candidate),
      value: candidate,
    })),
  )
}

function ambiguousError(name: string, candidates: InstanceCandidate[]): AstraleError {
  const lines = candidates.map((candidate) => `  - ${describeInstanceCandidate(candidate)}`)
  return new AstraleError(
    'INSTANCE_AMBIGUOUS',
    `Multiple instances match "${name}":\n${lines.join('\n')}`,
    'Run interactively to pick one, or `astrale instance forget <name>` to drop the stale bookmark.',
  )
}

export default {
  name: 'use',
  description: 'Set the active kernel instance (no args: show current)',
  afterHelpText: `
Behavior:
  The active instance lives in ~/.astrale/instances.json (a
  process-global file). Concurrent instance:prepare or parallel test
  runs can rewrite it under you — in scripted/parallel flows pass
  -i <instance> on every command instead of relying on \`use\`.

Examples:
  $ astrale instance use staging
  $ astrale instance use staging --adopt-default
`,
  arguments: [{ name: 'name', description: 'Registered instance name', required: false }],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    {
      flags: '--adopt-default',
      description: 'Adopt instance default identity without prompt',
    },
    { flags: '--skip-jwks-check', description: 'Skip the OIDC discovery + JWKS liveness probe' },
  ],
  action: async (name: string | undefined, opts: UseOpts) => {
    await useInstance(name, opts)
  },
} satisfies CommandDefinition
