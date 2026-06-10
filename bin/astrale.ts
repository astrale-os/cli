#!/usr/bin/env bun
import { type Command, CommanderError } from 'commander'

import { renderCommanderError } from '../src/lib/command-dx'
import { buildProgram } from '../src/program'

// exitOverride must be applied to every subcommand: Commander copies the exit
// callback into subcommands at creation time, so setting it on the root only
// would let subcommand parse errors (e.g. missing required argument) call
// process.exit() directly — bypassing the renderCommanderError catch below
// while writeErr suppression still applies, i.e. a silent exit.
function overrideExits(command: Command): void {
  command.exitOverride()
  for (const child of command.commands) overrideExits(child)
}

const program = await buildProgram()
overrideExits(program)
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
