import type { Command } from 'commander'

/** One positional argument in a CLI command definition. */
interface CommandArgument {
  readonly name: string
  readonly description: string
  readonly required?: boolean
  readonly variadic?: boolean
}

/** One Commander-compatible option in a CLI command definition. */
export interface CommandOption {
  readonly flags: string
  readonly description: string
  readonly default?: string
  readonly choices?: string[]
  readonly hidden?: boolean
  /** Collect every occurrence, in order, into a string array. */
  readonly repeatable?: boolean
}

/** Internal authoring shape implemented by each command module. */
export interface CommandDefinition {
  readonly name: string
  readonly description: string
  readonly summary?: string
  readonly hidden?: boolean
  readonly aliases?: string[]
  readonly arguments?: CommandArgument[]
  readonly options?: CommandOption[]
  readonly afterHelpText?: string
  /** Opaque Commander callback; each command module owns its concrete argument tuple. */
  readonly action: (...args: never[]) => Promise<void>
}

/** Internal composition shape for one group of commands. */
export interface CommandGroup {
  readonly name: string
  readonly description: string
  readonly summary?: string
  readonly commands: CommandDefinition[]
  /** Command run when the first argument names no command of the group. */
  readonly defaultCommand?: string
  readonly hidden?: boolean
  readonly subgroups?: CommandGroup[]
}

/** Build a fresh, complete Commander tree without parsing process arguments. */
export function buildProgram(): Promise<Command>

/** Route a root `--version` to the CLI version while subcommands keep their own `--version`. */
export function normalizeRootVersionArgv(argv: readonly string[]): string[]
