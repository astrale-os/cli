import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import type { CommandDefinition } from '../../command'

import { resolveDomainPlatform } from '../../adapters/domain-platform'
import { fatal, log } from '../../lib/log'

type Opts = {
  template?: string
  targetDir?: string
  force?: boolean
  platform?: string
}

function defaultTargetDir(slug: string): string {
  const cwd = process.cwd()
  const monorepoDomains = join(cwd, 'kernel', 'domains')
  if (existsSync(monorepoDomains)) return join(monorepoDomains, slug)
  if (basename(cwd) === 'domains' && basename(dirname(cwd)) === 'kernel') {
    return join(cwd, slug)
  }
  return join(cwd, slug)
}

export default {
  name: 'init',
  description: 'Scaffold a new domain from a template (§9.1)',
  arguments: [{ name: 'slug', description: 'Domain slug (kebab-case)', required: true }],
  options: [
    {
      flags: '--template <name>',
      description: 'Template to clone (default: minimal-remote)',
      default: 'minimal-remote',
    },
    {
      flags: '--target-dir <path>',
      description: 'Destination directory (default: kernel/domains/<slug>)',
    },
    { flags: '--force', description: 'Overwrite if the target directory exists' },
    {
      flags: '--platform <id>',
      description: 'DomainPlatform adapter id (default: cloudflare)',
      default: 'cloudflare',
    },
  ],
  action: async (slug: string, opts: Opts) => {
    try {
      const targetDir = opts.targetDir
        ? resolve(process.cwd(), opts.targetDir)
        : defaultTargetDir(slug)

      const platform = resolveDomainPlatform(opts.platform)
      log.step(`Scaffolding domain "${slug}" from template "${opts.template}"`)
      log.dim(`  target: ${targetDir}`)

      const result = await platform.scaffold({
        slug,
        template: opts.template ?? 'minimal-remote',
        targetDir,
        force: opts.force,
      })

      log.success(`Domain scaffolded at ${result.targetDir}`)
      console.log('')
      console.log('Next steps:')
      for (const line of result.nextSteps) console.log(`  ${line}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
