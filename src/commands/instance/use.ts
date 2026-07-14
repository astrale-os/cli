import type { CommandDefinition } from '../../command'

import { AstraleError } from '../../errors'
import { withAdminKernelClient } from '../../kernel/client'
import { adminInstanceMethod, type InstanceInfo } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { getDefault, setDefault } from '../../lib/identity'
import {
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

    if (!opts.skipJwksCheck && resolved.issuer) {
      try {
        await checkIssuerReachability(resolved.url, resolved.issuer)
      } catch (e) {
        fatal(e)
      }
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
  const { repointedFrom } = await upsertManagedBookmark(chosen.key, chosen.info.slug, chosen.url)
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
async function fetchManagedInstances(name: string, opts: UseOpts): Promise<InstanceInfo[]> {
  try {
    validateSlug(name)
  } catch {
    return []
  }
  try {
    return await withAdminKernelClient(
      opts,
      async (ctx) => (await ctx.client.call(adminInstanceMethod('list'), {})) as InstanceInfo[],
    )
  } catch {
    return []
  }
}

function assertManagedReady(info: InstanceInfo): void {
  if (!info.state || info.state === 'ready') return
  const detail = info.phase && info.phase !== info.state ? ` (${info.phase})` : ''
  throw new AstraleError(
    'INSTANCE_NOT_READY',
    `Instance "${info.slug}" is ${info.state}${detail}; it cannot be selected yet.`,
    info.error ?? undefined,
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
    { flags: '--skip-jwks-check', description: 'Skip the /meta ↔ JWKS match check' },
  ],
  action: async (name: string | undefined, opts: UseOpts) => {
    await useInstance(name, opts)
  },
} satisfies CommandDefinition
