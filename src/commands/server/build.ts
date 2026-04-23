import type { CommandDefinition } from '../../command'

import { buildManagerImage, managerImageTag } from '../../lib/docker'
import { fatal, log, spinner } from '../../lib/log'

export default {
  name: 'build',
  description: 'Build the local astrale-os/manager docker image (dev-local)',
  options: [{ flags: '--no-cache', description: 'Force full rebuild (docker build --no-cache)' }],
  action: async (opts: { noCache?: boolean }) => {
    try {
      const tag = await managerImageTag()
      const s = spinner(`Building image astrale-os/manager:${tag}...`)
      try {
        await buildManagerImage({ noCache: opts.noCache ?? false })
        s.succeed(`Built astrale-os/manager:${tag}`)
      } catch (e) {
        s.fail('docker build failed')
        throw e
      }
      log.dim('  run `astrale start` to launch the manager + FalkorDB services')
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
