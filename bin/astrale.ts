#!/usr/bin/env npx tsx
import { program } from 'commander'
import { authCommand } from '../src/commands/auth'
import { buildCommand } from '../src/commands/build'
import { createCommand } from '../src/commands/create'
import { devCommand } from '../src/commands/dev'
import { initCommand } from '../src/commands/init'
import { profileCommand } from '../src/commands/profile'
import { startCommand } from '../src/commands/start'

program
  .name('astrale')
  .description('Astrale CLI - build, develop, and deploy Astrale apps')
  .version('0.2.0')

program.addCommand(authCommand)
program.addCommand(profileCommand)
program.addCommand(initCommand)
program.addCommand(devCommand)
program.addCommand(buildCommand)
program.addCommand(createCommand)
program.addCommand(startCommand)

program.parse()
