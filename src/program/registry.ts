import { type Command, Option } from 'commander'

import type { CommandDefinition, CommandGroup } from './command'

type CommanderAction = Parameters<Command['action']>[0]

/**
 * Register a single command on a Commander program or subcommand.
 */
export function registerCommand(parent: Command, def: CommandDefinition): void {
  const cmd = parent.command(def.name, { hidden: def.hidden ?? false }).description(def.description)

  if (def.summary) cmd.summary(def.summary)

  if (def.aliases) {
    for (const alias of def.aliases) cmd.alias(alias)
  }

  if (def.arguments) {
    for (const arg of def.arguments) {
      const name = arg.variadic ? `${arg.name}...` : arg.name
      const bracket = arg.required !== false ? `<${name}>` : `[${name}]`
      cmd.argument(bracket, arg.description)
    }
  }

  if (def.options) {
    const valuedByEquals: string[] = []
    for (const opt of def.options) {
      if (opt.repeatable) {
        const o = new Option(opt.flags, opt.description)
        // Commander stores `true` for an optional value written bare, replacing what was
        // collected before; a preset value keeps every occurrence in the array.
        if (o.optional) o.preset('')
        o.argParser((value: string, previous: unknown) => [
          ...(Array.isArray(previous) ? (previous as string[]) : []),
          value,
        ])
        if (opt.hidden) o.hideHelp()
        cmd.addOption(o)
        if (o.optional && o.long !== undefined) valuedByEquals.push(o.long)
      } else if (opt.hidden) {
        const o = new Option(opt.flags, opt.description)
        if (opt.choices) o.choices(opt.choices)
        if (opt.default !== undefined) o.default(opt.default)
        o.hideHelp()
        cmd.addOption(o)
      } else if (opt.choices) {
        const o = new Option(opt.flags, opt.description)
        o.choices(opt.choices)
        if (opt.default !== undefined) o.default(opt.default)
        cmd.addOption(o)
      } else if (opt.default !== undefined) {
        cmd.option(opt.flags, opt.description, opt.default)
      } else {
        cmd.option(opt.flags, opt.description)
      }
    }
    if (valuedByEquals.length > 0) {
      // Commander gives an optional value the next argument when it is not an option; these
      // options take theirs only after `=`, so a bare occurrence is written `--flag=` (value '').
      const parseOptions = cmd.parseOptions.bind(cmd)
      cmd.parseOptions = (argv: string[]) =>
        parseOptions(bindOptionalValuesByEquals(argv, valuedByEquals))
    }
  }

  // CommandDefinition keeps each callback tuple opaque; Commander materializes
  // that tuple only after this definition has registered its arguments/options.
  cmd.action(def.action as CommanderAction)

  if (def.afterHelpText) cmd.addHelpText('after', def.afterHelpText)
}

/**
 * Rewrite each bare occurrence of the named long options, before a `--` literal, to `--flag=`, so
 * Commander never binds the next argument to them.
 */
export function bindOptionalValuesByEquals(
  argv: readonly string[],
  longFlags: readonly string[],
): string[] {
  const end = argv.indexOf('--')
  return argv.map((token, index) =>
    (end === -1 || index < end) && longFlags.includes(token) ? `${token}=` : token,
  )
}

/**
 * Register a command group (subcommand with nested commands). Supports
 * one level of nested subgroups via `group.subgroups`.
 */
export function registerGroup(parent: Command, group: CommandGroup): void {
  const sub = parent
    .command(group.name, { hidden: group.hidden ?? false })
    .description(group.description)
  if (group.summary) sub.summary(group.summary)
  for (const def of group.commands) {
    registerCommand(sub, def)
  }
  if (group.subgroups) {
    for (const nested of group.subgroups) {
      registerGroup(sub, nested)
    }
  }
}
