import { type Command, CommanderError } from 'commander'

import { renderCommanderError } from '../src/lib/command-dx'
import { configureInvocation } from '../src/lib/invocation'
import { maybeRunStartupMaintenance } from '../src/lib/startup-maintenance'
import { buildProgram, normalizeRootVersionArgv } from '../src/program/index'
import { beginInvocation } from '../src/telemetry/recorder'
import { scanSessions } from '../src/telemetry/store'
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

async function runInternalMode(): Promise<boolean> {
  const mode = process.argv[2]
  if (!mode?.startsWith('__studio-')) return false
  process.argv.splice(2, 1)
  if (mode === '__studio-server') await import('../studio/server/index')
  else if (mode === '__studio-extractor') await import('../studio/server/introspect/extractor')
  else if (mode === '__studio-bridge') await import('../studio/server/agent/bridge/stdio')
  else if (mode === '__studio-acp-codex') await import('@agentclientprotocol/codex-acp')
  else if (mode === '__studio-acp-claude')
    await import('@agentclientprotocol/claude-agent-acp/dist/index.js')
  else throw new Error(`unknown internal mode: ${mode}`)
  return true
}

async function main(): Promise<void> {
  if (await runInternalMode()) return

  const argv = normalizeRootVersionArgv(process.argv)
  configureInvocation(argv)
  try {
    if (await maybeRunStartupMaintenance(argv)) return
  } catch (error) {
    if (error instanceof Error && error.name === 'ExitPromptError') process.exit(130)
    throw error
  }

  // One store scan feeds recording, retention, and analysis. Internal Studio
  // modes and startup maintenance intentionally bypass user-command telemetry.
  const sessions = scanSessions()
  const finalize =
    process.argv[2] === 'session' ? undefined : beginInvocation(process.argv, sessions)
  let errorName: string | undefined
  if (finalize) process.on('exit', (code) => finalize(code ?? 0, errorName))
  maybeTriggerAnalysis(process.argv, sessions)

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
}

await main()
