import {
  BlaxelTargetStore,
  deployBlaxelTarget,
  loadBlaxelDeployFile,
} from '@astrale-os/kernel-host/blaxel/deploy'

import type { CommandDefinition } from '../command'

import { log } from '../lib/log'

type DeployOptions = {
  config?: string
  replaceBinding?: boolean
  store?: string
  astraleHome?: string
}

async function deployCommand(target: string, opts: DeployOptions): Promise<void> {
  const cwd = process.cwd()
  const deployFile = await loadBlaxelDeployFile({ cwd, file: opts.config })
  const store = new BlaxelTargetStore(opts.store)
  const result = await deployBlaxelTarget({
    target,
    deployFile,
    replaceBinding: opts.replaceBinding,
    store,
    astraleHome: opts.astraleHome,
  })

  log.success(`deployed target "${result.target}"`)
  log.info(`sandbox: ${result.binding.name}`)
  for (const [name, url] of Object.entries(result.urls)) {
    log.info(`${name}: ${url}`)
  }
}

const command: CommandDefinition = {
  name: 'deploy',
  description: 'Build and deploy a target from astrale.deploy.ts',
  arguments: [{ name: 'target', description: 'Target name from astrale.deploy.ts' }],
  options: [
    {
      flags: '--config <path>',
      description: 'Blaxel deploy file path (default: astrale.deploy.ts)',
    },
    {
      flags: '--replace-binding',
      description: 'Replace the concrete platform resource behind this target',
    },
    {
      flags: '--store <path>',
      description: 'Blaxel target store path (default: .astrale/blaxel-targets.json)',
    },
    {
      flags: '--astrale-home <path>',
      description: 'Astrale home for keys and deployment summaries',
    },
  ],
  afterHelpText: `
Examples:
  astrale deploy demo
  astrale deploy demo --replace-binding
  astrale deploy demo --config ./astrale.deploy.ts
`,
  action: deployCommand,
}

export default command
