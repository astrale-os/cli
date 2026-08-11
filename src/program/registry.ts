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
      const bracket = arg.required !== false ? `<${arg.name}>` : `[${arg.name}]`
      cmd.argument(bracket, arg.description)
    }
  }

  if (def.options) {
    for (const opt of def.options) {
      if (opt.choices) {
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
  }

  // CommandDefinition keeps each callback tuple opaque; Commander materializes
  // that tuple only after this definition has registered its arguments/options.
  cmd.action(def.action as CommanderAction)

  if (def.afterHelpText) cmd.addHelpText('after', def.afterHelpText)
}

/**
 * Register a command group (subcommand with nested commands). Supports
 * one level of nested subgroups via `group.subgroups`.
 */
export function registerGroup(parent: Command, group: CommandGroup): void {
  const sub = parent.command(group.name).description(group.description)
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
