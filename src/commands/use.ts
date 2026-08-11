import type { CommandDefinition } from '../program/index'

import { setDefault } from '../lib/identity'
import { readIdentities } from '../lib/identity'
import { readInstances } from '../lib/instance'
import { fatal, log } from '../lib/log'
import { resolveUseTarget } from '../lib/use-target'
import instanceUseCommand from './instance/use'

type UseOpts = {
  identity?: boolean
  instance?: boolean
  adoptDefault?: boolean
  skipJwksCheck?: boolean
}

async function useIdentity(name: string): Promise<void> {
  await setDefault(name)
  log.success(`Active identity set to "${name}"`)
}

export default {
  name: 'use',
  description: 'Set the active identity or instance when the name is unambiguous',
  afterHelpText: `
Behavior:
  \`astrale use <name>\` is a convenience resolver for local CLI context. It
  switches identity when <name> is only an identity, switches instance when
  <name> is only an instance, and refuses ambiguous names. In scripts, prefer
  the explicit namespace commands or pass --identity / --instance.

Examples:
  $ astrale use staging
  $ astrale use alice
  $ astrale use staging --instance
  $ astrale use alice --identity
`,
  arguments: [{ name: 'name', description: 'Identity or instance name', required: true }],
  options: [
    { flags: '--identity', description: 'Treat <name> as an identity' },
    { flags: '--instance', description: 'Treat <name> as an instance' },
    { flags: '--adopt-default', description: 'When using an instance, adopt its default identity' },
    { flags: '--skip-jwks-check', description: 'When using an instance, skip the JWKS check' },
  ],
  action: async (name: string, opts: UseOpts) => {
    try {
      if (opts.identity && opts.instance) {
        fatal('Choose either --identity or --instance, not both')
      }

      if (opts.identity) {
        await useIdentity(name)
        return
      }

      if (opts.instance) {
        await instanceUseCommand.action(name, opts)
        return
      }

      const [instances, identities] = await Promise.all([readInstances(), readIdentities()])
      const target = resolveUseTarget(name, instances, identities)

      if (target.kind === 'identity') {
        await useIdentity(target.name)
        return
      }

      if (target.kind === 'instance') {
        await instanceUseCommand.action(target.name, opts)
        return
      }

      if (target.kind === 'ambiguous') {
        fatal(
          `Both an identity and an instance are named "${name}". Use: astrale identity use ${name} or astrale instance use ${name}`,
        )
      }

      fatal(
        `No identity or instance named "${name}". Try: astrale identity list or astrale instance list`,
      )
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
