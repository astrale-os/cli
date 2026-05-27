// NOTE (temporary workaround): `@astrale-os/kernel-host/blaxel/deploy` is not
// exported by the locally-linked kernel/host yet (v0.7.0 on `main`); the blaxel
// deploy stack only lives on the `demo-sandbox` branch. program.ts eagerly
// `await import`s every command module on each CLI run, so a top-level *value*
// import of this missing subpath crashes the WHOLE CLI at load. It's deferred
// into the action below so every other command keeps working; `astrale deploy`
// only resolves it once kernel/host main ships the export.
import type { BlaxelTargetSpec } from '@astrale-os/kernel-host/blaxel/deploy'

import type { CommandDefinition } from '../command'

import { log } from '../lib/log'

type DeployOptions = {
  name?: string
  region?: string
  bookmark?: string
  identity?: string
  image?: string
  template?: string
  memory?: string
  persist?: boolean
  pin?: string
  deploy?: boolean
  skipBookmark?: boolean
  bundle?: boolean
  gui?: boolean
  workers?: boolean
  recreate?: boolean
  store?: string
  astraleHome?: string
}

async function deployCommand(target: string, opts: DeployOptions): Promise<void> {
  const { BlaxelTargetStore, deployBlaxelTarget } =
    await import('@astrale-os/kernel-host/blaxel/deploy')
  const store = new BlaxelTargetStore(opts.store)
  const result = await deployBlaxelTarget({
    target,
    targetSpec: targetSpecFromOptions(opts),
    recreate: opts.recreate,
    store,
    astraleHome: opts.astraleHome,
  })

  log.success(`deployed target "${result.target}"`)
  log.info(`sandbox: ${result.binding.name}`)
  for (const [name, url] of Object.entries(result.urls)) {
    log.info(`${name}: ${url}`)
  }
}

function targetSpecFromOptions(opts: DeployOptions): BlaxelTargetSpec {
  const memory = opts.memory === undefined ? undefined : Number(opts.memory)
  if (memory !== undefined && (!Number.isFinite(memory) || memory <= 0)) {
    throw new Error(`--memory must be a positive number, got: ${opts.memory}`)
  }

  return {
    name: opts.name,
    region: opts.region,
    bookmark: opts.bookmark,
    identity: opts.identity,
    image: opts.image,
    template: opts.template,
    memory,
    persist: opts.persist,
    pin: opts.pin,
    noDeploy: opts.deploy === false,
    noBookmark: opts.skipBookmark,
    noBundle: opts.bundle === false,
    noGui: opts.gui === false,
    noWorkers: opts.workers === false,
  }
}

const command: CommandDefinition = {
  name: 'deploy',
  description: 'Build and deploy an Astrale kernel host on Blaxel',
  arguments: [{ name: 'target', description: 'Target name / default sandbox name' }],
  options: [
    { flags: '--name <name>', description: 'Concrete Blaxel sandbox name (default: target)' },
    { flags: '--region <region>', description: 'Blaxel region (default: eu-fra-1)' },
    { flags: '--bookmark <name>', description: 'CLI bookmark name (default: sandbox name)' },
    { flags: '--identity <name>', description: 'CLI identity name (default: <sandbox>-system)' },
    { flags: '--image <ref>', description: 'Use an existing sandbox image ref' },
    { flags: '--template <name>', description: 'Sandbox template name (default: blaxel)' },
    { flags: '--memory <mb>', description: 'Sandbox memory in MB (default: 4096)' },
    { flags: '--persist', description: 'Mount a persistent Blaxel volume at /data' },
    { flags: '--pin <pin>', description: 'Override the GUI PIN' },
    {
      flags: '--recreate',
      description: 'Delete and recreate the concrete platform resource behind this target',
    },
    { flags: '--no-deploy', description: 'Skip bl deploy' },
    { flags: '--skip-bookmark', description: 'Skip astrale instance bookmark' },
    { flags: '--no-bundle', description: 'Skip kernel, gateway, GUI, and worker bundling' },
    { flags: '--no-gui', description: 'Skip GUI build/bundling' },
    { flags: '--no-workers', description: 'Skip service worker deploys and domain installs' },
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
  astrale deploy demo --recreate
  astrale deploy demo --pin 482910
  astrale deploy demo --no-gui --no-bundle --no-deploy
`,
  action: deployCommand,
}

export default command
