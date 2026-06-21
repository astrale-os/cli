import chalk from 'chalk'

import type { CommandDefinition } from '../command'

import { readLocalStatus } from '../lib/local-status'
import { log } from '../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS } from '../lib/output'

export default {
  name: 'status',
  description: 'Show local CLI context: active instance, identity, and cached auth state',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: { raw?: boolean; json?: boolean }) => {
    const status = await readLocalStatus()

    if (isMachine(opts)) {
      output(status, opts)
      return
    }

    console.log(chalk.bold('Admin'))
    if ('error' in status.admin) {
      console.log(`  ${chalk.red('invalid')}: ${status.admin.error}`)
    } else {
      console.log(`  ${chalk.bold(status.admin.name)} ${chalk.dim(status.admin.url)}`)
    }

    console.log('')
    console.log(chalk.bold('Instance'))
    if (status.instance) {
      console.log(`  ${chalk.bold(status.instance.active)} ${chalk.dim(status.instance.url)}`)
      if (status.instance.issuer) console.log(`  issuer: ${chalk.dim(status.instance.issuer)}`)
      if (status.instance.defaultIdentity) {
        console.log(`  default identity: ${status.instance.defaultIdentity}`)
      }
    } else {
      log.dim('  No active instance. Run: astrale instance bookmark <name> --url <url> --use')
    }

    console.log('')
    console.log(chalk.bold('Identity'))
    if (status.identity) {
      const source =
        status.identity.source === 'idp'
          ? `idp:${status.identity.idp ?? 'unknown'}`
          : status.identity.source
      console.log(`  ${chalk.bold(status.identity.name)} ${chalk.dim(`[${source}]`)}`)
      console.log(`  subject: ${chalk.dim(status.identity.subject)}`)
      if (status.identity.session) {
        const state =
          !status.identity.session.cached || status.identity.session.requiresLogin
            ? chalk.yellow('login required')
            : chalk.green('ready')
        console.log(`  session: ${state}`)
      }
    } else {
      log.dim('  No default identity. Run: astrale identity create <name>')
    }
  },
} satisfies CommandDefinition
