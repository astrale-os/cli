import type { CommandOption } from '../program/index'

/**
 * Flags consumed by `withKernelClient` (and therefore valid on any command
 * that talks to a kernel). Spread these into a command's `options` to expose
 * the same `--url / --instance / --timeout / --as / --creds / --debug`
 * surface as `astrale call`.
 */
export const KERNEL_PASSTHROUGH_OPTIONS: CommandOption[] = [
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
  { flags: '--debug', description: 'Print full error diagnostics on failure' },
]
