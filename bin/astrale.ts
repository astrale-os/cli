#!/usr/bin/env npx tsx
import { Command, program } from 'commander'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { authCommand, runLogin } from '../src/commands/auth'
import { buildCommand } from '../src/commands/build'
import { createCommand } from '../src/commands/create'
import { devCommand } from '../src/commands/dev'
import { initCommand } from '../src/commands/init'
import { profileCommand } from '../src/commands/profile'
import { startCommand } from '../src/commands/start'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = join(__dirname, __dirname.includes('/dist/') ? '../..' : '..', 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

program
  .name('astrale')
  .description('Astrale CLI - build, develop, and deploy Astrale apps')
  .version(pkg.version)

program.addCommand(authCommand)
program.addCommand(profileCommand)
program.addCommand(initCommand)
program.addCommand(devCommand)
program.addCommand(buildCommand)
program.addCommand(createCommand)
program.addCommand(startCommand)
program.addCommand(
  new Command('login')
    .description('Authenticate with Astrale (alias for auth login)')
    .option('--profile <name>', 'Profile to authenticate')
    .action(async (opts) => {
      try {
        await runLogin(opts.profile)
      } catch (err) {
        console.error('[astrale] Login failed:', err instanceof Error ? err.message : err)
        process.exit(1)
      }
    }),
)

program.parse()
