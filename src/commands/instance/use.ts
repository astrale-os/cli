import type { CommandDefinition } from '../../command'

import { AstraleError } from '../../errors'
import { withAdminKernelClient } from '../../kernel/client'
import { ADMIN_INSTANCE, type InstanceInfo } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { getDefault, setDefault } from '../../lib/identity'
import {
  getActive,
  normalizeInstanceKernelUrl,
  readInstances,
  resolveInstance,
  resolveInstanceKey,
  setActive,
  upsertInstance,
  type ResolvedInstance,
} from '../../lib/instance'
import { fatal, log } from '../../lib/log'
import { checkIssuerReachability } from '../../lib/meta'
import { confirmDefaultYes } from '../../lib/prompt'
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

    const { resolved, materialized } = await resolveUseTarget(name, opts)

    if (!opts.skipJwksCheck && resolved.issuer) {
      try {
        await checkIssuerReachability(resolved.url, resolved.issuer)
      } catch (e) {
        fatal(e)
      }
    }

    await setActive(resolved.name)
    log.success(`Active instance: ${resolved.name} (${resolved.url})`)
    if (materialized) log.dim('  managed instance bookmarked locally')

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

async function resolveUseTarget(
  name: string,
  opts: UseOpts,
): Promise<{ resolved: ResolvedInstance; materialized: boolean }> {
  let notFound: AstraleError
  try {
    return { resolved: await resolveInstance(name), materialized: false }
  } catch (e) {
    if (!(e instanceof AstraleError) || e.code !== 'INSTANCE_NOT_FOUND') throw e
    notFound = e
  }

  try {
    validateSlug(name)
  } catch {
    throw notFound
  }

  let managed: InstanceInfo
  try {
    managed = await withAdminKernelClient(
      opts,
      async (ctx) =>
        (await ctx.client.call(`${ADMIN_INSTANCE}/info`, { id: name })) as InstanceInfo,
    )
  } catch {
    throw notFound
  }
  const url = normalizeInstanceKernelUrl(managed.url)
  const { entry } = await upsertInstance(managed.slug, {
    url,
    issuer: url,
    slug: managed.slug,
    name: managed.slug,
    kind: 'bookmark',
    mode: 'remote',
  })

  return {
    resolved: {
      name: managed.slug,
      kind: 'bookmark',
      url: entry.url ?? url,
      issuer: entry.issuer ?? url,
      createdAt: entry.createdAt,
      defaultIdentity: entry.defaultIdentity,
      caFile: entry.caFile,
      mode: entry.mode,
      status: 'managed',
    },
    materialized: true,
  }
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
