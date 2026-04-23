import type { FnMap, KernelClient } from '@astrale-os/kernel-client'

import { log } from './log'

// kernel/core/auth/permissions/semantic.ts — bit 2.
const USE_PERM = 4

/**
 * Bootstrap grants for the `distribution` domain — mirrors the grants
 * issued by `kernel/domains/distribution/test/e2e/setup.ts` (§4.3 admin
 * enrollment is tracked separately; this function only ensures the
 * installed domain is runnable).
 *
 * The grantees are the worker function paths themselves: when the Cloudflare
 * Worker runs a BlaxelComputer method, it needs USE on the kernel primitives
 * (Node.createNode/update/deleteNode/get/link) plus the domain root.
 */
export async function grantDistributionBootstrap(
  client: KernelClient<FnMap>,
  credential: string,
  domainOrigin: string,
): Promise<void> {
  const methods = ['init', 'list', 'delete', 'deployFunction', 'deleteFunction']
  const workerFnPaths = methods.map((m) => `/${domainOrigin}/class.BlaxelComputer/${m}`)
  const primitives = [
    '/kernel.astrale.ai/interface.Node/createNode',
    '/kernel.astrale.ai/interface.Node/update',
    '/kernel.astrale.ai/interface.Node/deleteNode',
    '/kernel.astrale.ai/interface.Node/get',
    '/kernel.astrale.ai/interface.Node/link',
    `/${domainOrigin}`,
  ]

  let granted = 0
  for (const grantee of workerFnPaths) {
    for (const target of primitives) {
      await client.call(`${grantee}::grantPerm`, { node: target, perms: USE_PERM }, credential)
      granted++
    }
  }
  log.dim(`  bootstrap grants: ${granted} (worker functions × kernel primitives)`)
}
