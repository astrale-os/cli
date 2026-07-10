import { readFile } from 'node:fs/promises'

import type { CommandDefinition } from '../command'
import type { ViewServeConfig } from '../lib/view/session'

import { startViewServer } from '../lib/view/server'

/**
 * Internal (hidden) entry for the detached view-session server: `astrale view`
 * re-invokes the CLI with `__view-serve --config <file>` so the server runs
 * under the same runtime and codebase as the CLI itself.
 */
export default {
  name: '__view-serve',
  hidden: true,
  description: 'Internal: run a view-session server from a config file',
  options: [{ flags: '--config <path>', description: 'ViewServeConfig JSON path' }],
  action: async (opts: { config?: string }) => {
    if (!opts.config) throw new Error('--config is required')
    const config = JSON.parse(await readFile(opts.config, 'utf8')) as ViewServeConfig
    startViewServer(config)
    console.log(`view session ${config.session.id} listening on ${config.session.pageUrl}`)
    // Keep the process alive; startViewServer owns shutdown (signals + idle).
    await new Promise(() => {})
  },
} satisfies CommandDefinition
