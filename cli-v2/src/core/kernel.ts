import type { Kernel } from '@astrale-os/kernel-api'
import type { GraphAdapter } from '@astrale/typegraph-client'
import { boot } from '@astrale-os/kernel-runtime/boot'
import { createDeps, generateAuth } from '@astrale-os/kernel-toolkit/presets'
import { installDistribution } from '@astrale-os/kernel-toolkit/distribution'
import { clearGraph } from '@astrale/typegraph-adapter-falkordb'

import { log } from '../lib/logger'
import type { ResolvedConfig } from '../lib/config'
import type { LoadedDistribution } from './distribution'

export interface DevKernelSession {
  kernel: Kernel
  graphAdapter: GraphAdapter
  operationCount: number
  /** Gracefully disconnect the graph adapter. */
  shutdown: () => Promise<void>
}

export interface BootDevKernelOptions {
  config: ResolvedConfig
  distribution: LoadedDistribution
  clear: boolean
}

/**
 * Boot a dev kernel: create deps, optionally clear graph, connect adapter,
 * generate auth, boot kernel, install distribution.
 *
 * Returns a session handle with the running kernel and a shutdown function.
 */
export async function bootDevKernel(options: BootDevKernelOptions): Promise<DevKernelSession> {
  const { config, distribution, clear } = options
  const dist = distribution.config

  const { deps, graphAdapter } = createDeps(config.preset, {
    graphName: config.graphName,
    host: config.host,
    port: config.port,
    issuer: config.issuer,
  })

  if (clear) {
    log.info('Clearing graph...')
    await clearGraph({
      graphName: config.graphName,
      host: config.host,
      port: config.port,
    })
    log.success('Graph cleared')
  }

  log.info('Booting kernel...')
  await graphAdapter.connect()
  const auth = await generateAuth({ issuer: config.issuer, subject: 'dev' })
  const { kernel, graph } = await boot({ deps, auth })
  log.success('Kernel booted')

  const installStart = performance.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const installResult = await installDistribution(kernel, graph, auth.systemAuth, dist as any)
  const installMs = Math.round(performance.now() - installStart)
  const operationCount = installResult.operations.filter(
    (o: { status: string }) => o.status === 'registered',
  ).length
  log.success(`Distribution "${dist.name}" installed (${operationCount} operations) in ${installMs}ms`)

  return {
    kernel,
    graphAdapter,
    operationCount,
    shutdown: async () => {
      await graphAdapter.disconnect?.()
    },
  }
}
