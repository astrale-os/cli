import type { KernelRuntime, GraphAdapter } from '@astrale-os/kernel-runtime'
import { KernelSession, generateAuth } from '@astrale-os/kernel-toolkit'
import { clearGraph } from '@astrale/typegraph-adapter-falkordb'

import { log } from '../lib/logger'
import type { ResolvedConfig } from '../lib/config'

export interface DevKernelSession {
  kernel: KernelRuntime
  graphAdapter: GraphAdapter
  refsCount: number
  shutdown: () => Promise<void>
}

export interface BootDevKernelOptions {
  config: ResolvedConfig
  clear: boolean
}

/**
 * Boot a dev kernel: connect, optionally clear graph, boot runtime.
 */
export async function bootDevKernel(options: BootDevKernelOptions): Promise<DevKernelSession> {
  const { config, clear } = options

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
  const auth = await generateAuth({ issuer: config.issuer, subject: 'dev' })
  const session = await KernelSession.boot({
    graphName: config.graphName,
    auth,
    host: config.host,
    port: config.port,
    issuer: config.issuer,
    subject: 'dev',
  })
  log.success('Kernel booted')

  return {
    kernel: session.runtime,
    graphAdapter: session.adapter,
    refsCount: 0,
    shutdown: () => session.close(),
  }
}
