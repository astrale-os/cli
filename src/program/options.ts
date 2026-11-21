import type { CommandDefinition, CommandOption } from './command'

import { DEFAULT_TIMEOUT_MS, DEFAULT_WAIT_MS } from '../connection/timeouts'
import { RAW_OUTPUT_OPTIONS } from '../lib/terminal/output'

const KERNEL_PASSTHROUGH_OPTIONS: readonly CommandOption[] = Object.freeze([
  {
    flags: '--url <url>',
    description: 'Target a kernel URL directly (overrides instance resolution)',
  },
  {
    flags: '-i, --instance <name>',
    description: 'Target a specific instance (overrides active)',
  },
  {
    flags: '--timeout <ms>',
    description: `Request timeout in ms (default: ${DEFAULT_TIMEOUT_MS})`,
  },
  { flags: '--as <identity>', description: 'Call as a specific identity' },
  { flags: '--creds <token>', description: 'Use a pre-signed credential (e.g. delegation token)' },
  {
    flags: '--anonymous',
    description:
      'Send no credential (cannot be combined with --as or --creds; --as and --creds are mutually exclusive)',
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

/**
 * `--timeout` of a command that waits for an Execution's outcome: while it waits, the value bounds
 * the request and the wait together, and without it the wait has its own default.
 */
export const WAIT_TIMEOUT_OPTION: CommandOption = Object.freeze({
  flags: '--timeout <ms>',
  description: `Request timeout in ms (default: ${DEFAULT_TIMEOUT_MS}); while waiting for the outcome, it bounds the request and the wait together (default wait: ${DEFAULT_WAIT_MS})`,
})

/**
 * Attach the single canonical option set to one Kernel-touching command. An option the command
 * declares with the same flags as a canonical one takes its place, so its help says what it means
 * for that command.
 */
export function withKernelOptions(definition: CommandDefinition): CommandDefinition {
  const own = definition.options ?? []
  const declared = (option: CommandOption) => own.find(({ flags }) => flags === option.flags)
  return {
    ...definition,
    options: [
      ...own.filter((option) => !KERNEL_OPTIONS.some(({ flags }) => flags === option.flags)),
      ...KERNEL_OPTIONS.map((option) => declared(option) ?? option),
    ],
  }
}
