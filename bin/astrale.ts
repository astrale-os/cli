#!/usr/bin/env bun
import { type Command, CommanderError } from 'commander'

import { renderCommanderError } from '../src/lib/command-dx'
import { configureInvocation } from '../src/lib/invocation'
import { buildProgram, normalizeRootVersionArgv } from '../src/program/index'
import { beginInvocation } from '../src/telemetry/recorder'
import { maybeTriggerAnalysis } from '../src/telemetry/trigger'

// exitOverride must be applied to every subcommand: Commander copies the exit
// callback into subcommands at creation time, so setting it on the root only
// would let subcommand parse errors (e.g. missing required argument) call
// process.exit() directly — bypassing the renderCommanderError catch below
// while writeErr suppression still applies, i.e. a silent exit.
function overrideExits(command: Command): void {
  command.exitOverride()
  for (const child of command.commands) overrideExits(child)
}

// Telemetry: one event per invocation, written in the exit handler so every
// path (success, thrown error, process.exit) is captured. `session` commands
// are never recorded — analyzing a closed session must not reopen it.
const finalize = process.argv[2] === 'session' ? undefined : beginInvocation(process.argv)
let errorName: string | undefined
if (finalize) process.on('exit', (code) => finalize(code ?? 0, errorName))
maybeTriggerAnalysis(process.argv)

const argv = normalizeRootVersionArgv(process.argv)
configureInvocation(argv)

const program = await buildProgram()
overrideExits(program)
program.configureOutput({ writeErr: () => undefined })

try {
  await program.parseAsync(argv)
} catch (error) {
  if (error instanceof CommanderError) {
    if (error.exitCode === 0) process.exit(0)
    errorName = error.code ?? 'CommanderError'
    process.stderr.write(renderCommanderError(program, error) + '\n')
    process.exit(error.exitCode ?? 1)
  }
  // Ctrl-C at an interactive (@inquirer/prompts) prompt — exit quietly, the
  // shell convention for SIGINT, instead of dumping an error stack.
  if (error instanceof Error && error.name === 'ExitPromptError') {
    errorName = 'ExitPromptError'
    process.exit(130)
  }
  errorName = error instanceof Error ? error.name : 'UnknownError'
  throw error
}
