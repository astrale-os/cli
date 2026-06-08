#!/usr/bin/env bun
import { CommanderError } from 'commander'

import { renderCommanderError } from '../src/lib/command-dx'
import { buildProgram } from '../src/program'

const program = await buildProgram()
program.exitOverride()
program.configureOutput({ writeErr: () => undefined })

try {
  await program.parseAsync()
} catch (error) {
  if (error instanceof CommanderError) {
    if (error.exitCode === 0) process.exit(0)
    process.stderr.write(renderCommanderError(program, error) + '\n')
    process.exit(error.exitCode ?? 1)
  }
  throw error
}
