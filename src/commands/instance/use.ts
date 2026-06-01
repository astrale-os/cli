import type { CommandDefinition } from '../../command'

import { getDefault, setDefault } from '../../lib/identity'
import {
  getActive,
  readInstances,
  resolveInstance,
  resolveInstanceKey,
  setActive,
} from '../../lib/instance'
import { fatal, log } from '../../lib/log'
import { checkIssuerReachability } from '../../lib/meta'
import { confirmDefaultYes } from '../../lib/prompt'

type UseOpts = {
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

    const resolved = await resolveInstance(name)

    if (!opts.skipJwksCheck && resolved.issuer) {
      try {
        await checkIssuerReachability(resolved.url, resolved.issuer)
      } catch (e) {
        fatal(e)
      }
    }

    await setActive(name)
    log.success(`Active instance: ${name} (${resolved.url})`)

    // §7.1 identity-adoption prompt (DX). Orthogonality preserved — we
    // only switch on explicit user consent (or --adopt-default in CI).
    const store = await readInstances()
    const key = resolveInstanceKey(store, name)
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

    const msg = `Instance "${name}" has default identity "${identityCandidate}". Active: "${active?.name ?? 'none'}". Switch identity too?`
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
