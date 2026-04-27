import type { FnMap } from '@astrale-os/kernel-client'
import type { ClientSession } from '@astrale-os/kernel-client/session'

import { log } from './log'

// kernel/core/auth/permissions/semantic.ts — bit 2.
const USE_PERM = 4

/**
 * Bootstrap grants for the `distribution` domain — mirrors the grants
 * issued by `kernel/domains/distribution/test/e2e/setup.ts`.
 *
 * The grantees are the worker function paths themselves: when the Cloudflare
 * Worker runs a method, it needs USE on the static namespace syscalls it
 * invokes via `kernel.call(...)` plus the domain root. Instance syscalls
 * (`@id::link`, `::get`, `::grantPerm`, `::extendIdentity`, …) dispatch
 * based on per-node perms, not USE on a namespace path, so they don't need
 * to appear here.
 */
export async function grantDistributionBootstrap(
  client: ClientSession<FnMap>,
  _credential: string,
  domainOrigin: string,
): Promise<void> {
  const blaxelMethods = ['init', 'list', 'delete', 'deployFunction', 'deleteFunction']
  const workerFnPaths = [
    ...blaxelMethods.map((m) => `/${domainOrigin}/class.BlaxelComputer/${m}`),
    `/${domainOrigin}/class.Distribution/init`,
    `/${domainOrigin}/class.User/init`,
    `/${domainOrigin}/class.User/desktops`,
    `/${domainOrigin}/class.User/homes`,
    `/${domainOrigin}/class.Desktop/items`,
    `/${domainOrigin}/class.View/resolve`,
  ]
  const primitives = [
    '/kernel.astrale.ai/interface.Node/createNode',
    '/kernel.astrale.ai/interface.Node/update',
    '/kernel.astrale.ai/interface.Node/deleteNode',
    '/kernel.astrale.ai/interface.Node/get',
    '/kernel.astrale.ai/interface.Node/link',
    '/kernel.astrale.ai/class.Root/query',
    `/${domainOrigin}`,
  ]

  let granted = 0
  for (const grantee of workerFnPaths) {
    for (const target of primitives) {
      await client.call(
        `${grantee}::grantPerm`,
        { node: target, perms: USE_PERM },
      )
      granted++
    }
  }
  log.dim(`  bootstrap grants: ${granted} (worker functions × kernel primitives)`)
}
