#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { program } from 'commander'

import { createCommand } from '../src/commands/create'
import { devCommand } from '../src/commands/dev'
import { generateCommand } from '../src/commands/generate'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))

program
  .name('astrale')
  .description('Astrale — build distributions for the Astrale kernel')
  .version(pkg.version)
  .action(() => program.help({ error: false }))

program.addCommand(createCommand)
program.addCommand(devCommand)
program.addCommand(generateCommand)

program.parse()
