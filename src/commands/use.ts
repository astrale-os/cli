import { IssuerUnreachableError } from '../errors'
import { getDefault, setDefault } from '../lib/identity'
import {
  getActive,
  readInstances,
  resolveInstance,
  resolveInstanceKey,
  setActive,
} from '../lib/instance'
import { fatal, log } from '../lib/log'
import { checkIssuerReachability } from '../lib/meta'
import { confirmDefaultYes } from '../lib/prompt'

export type UseOpts = {
  ci?: boolean
  noPrompt?: boolean
  adoptDefault?: boolean
  skipJwksCheck?: boolean
}

export async function useCommand(name?: string, opts: UseOpts = {}): Promise<void> {
  try {
    if (!name) {
      const { name: activeName } = await getActive()
      const { url } = await resolveInstance(activeName).catch(() => ({ url: undefined }))
      console.log(`${activeName} (${url ?? 'local'})`)
      return
    }

    // Resolve url/issuer via the live manager (or bookmark entry). If the
    // target is unknown locally AND absent from the manager, resolveInstance
    // throws — let `setActive` below handle the probe-and-persist path.
    const resolved = await resolveInstance(name).catch(() => null)

    // §7 JWKS reachability — tunneled block, proxied warn.
    if (!opts.skipJwksCheck && resolved?.url && resolved.issuer) {
      const tunneled = !/\.astrale\.localhost(:\d+)?$/.test(resolved.issuer)
      try {
        await checkIssuerReachability(resolved.url, resolved.issuer)
      } catch (e) {
        if (e instanceof IssuerUnreachableError && !tunneled) {
          log.warn(`Issuer not reachable yet — ${e.message}`)
          log.dim('  hint: `astrale start` (proxy may be down).')
        } else {
          fatal(e)
        }
      }
    }

    await setActive(name)
    log.success(`Active instance: ${name} (${resolved?.url ?? 'local'})`)

    // §7.1 identity-adoption prompt (DX). Orthogonality preserved — we
    // only switch on explicit user consent (or --adopt-default in CI).
    const store = await readInstances()
    const key = resolveInstanceKey(store, name)
    const identityCandidate =
      resolved?.defaultIdentity ?? (key ? store.instances[key]?.defaultIdentity : undefined)
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
      log.dim('  kept active identity (orthogonal, §2.5)')
    }
  } catch (e) {
    fatal(e)
  }
}
