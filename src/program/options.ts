import type { CommandDefinition, CommandOption } from './command'

import { RAW_OUTPUT_OPTIONS } from '../lib/output'

const KERNEL_PASSTHROUGH_OPTIONS: readonly CommandOption[] = Object.freeze([
  {
    flags: '--url <url>',
    description: 'Target a kernel URL directly (overrides instance resolution)',
  },
  {
    flags: '-i, --instance <name>',
    description: 'Target a specific instance (overrides active)',
  },
  { flags: '--timeout <ms>', description: 'Request timeout in ms (default: 30000)' },
  { flags: '--as <identity>', description: 'Call as a specific identity' },
  { flags: '--creds <token>', description: 'Use a pre-signed credential (e.g. delegation token)' },
  {
    flags: '--anonymous',
    description: 'Send no credential (cannot be combined with --as or --creds)',
  },
  { flags: '--debug', description: 'Print full error diagnostics on failure' },
])

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
