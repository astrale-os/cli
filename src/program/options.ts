import type { CommandDefinition, CommandOption } from './command'

import { KERNEL_PASSTHROUGH_OPTIONS } from '../kernel/options'
import { RAW_OUTPUT_OPTIONS } from '../lib/output'

const KERNEL_OPTIONS: readonly CommandOption[] = Object.freeze([
  {
    flags: '--format <type>',
    description: 'Output format (default: yaml in TTY, json when piped)',
    choices: ['yaml', 'json'],
  },
  ...RAW_OUTPUT_OPTIONS,
  ...KERNEL_PASSTHROUGH_OPTIONS,
])

/** Attach the single canonical option set to one Kernel-touching command. */
export function withKernelOptions(definition: CommandDefinition): CommandDefinition {
  return {
    ...definition,
    options: [...(definition.options ?? []), ...KERNEL_OPTIONS],
  }
}
