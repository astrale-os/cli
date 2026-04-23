import { type Command, Option } from 'commander'

import type { CommandDefinition, CommandGroup } from './command'

/**
 * Register a single command on a Commander program or subcommand.
 */
export function registerCommand(parent: Command, def: CommandDefinition): void {
  const cmd = parent.command(def.name).description(def.description)

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

  cmd.action(def.action)
}

/**
 * Register a command group (subcommand with nested commands). Supports
 * one level of nested subgroups via `group.subgroups`.
 */
export function registerGroup(parent: Command, group: CommandGroup): void {
  const sub = parent.command(group.name).description(group.description)
  for (const def of group.commands) {
    registerCommand(sub, def)
  }
  if (group.subgroups) {
    for (const nested of group.subgroups) {
      registerGroup(sub, nested)
    }
  }
}
