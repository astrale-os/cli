import type { KernelCommandOpts } from '../../connection'
import type { RawOutputOpts } from '../../lib/output'
import type { CommandDefinition } from '../../program/index'

import { formatKernelError } from '../../connection/errors'
import { AstraleError } from '../../errors'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { fatal, withSpinner } from '../../lib/log'
import { isMachine, output } from '../../lib/output'
import {
  listInstalled,
  renderInstalled,
  type InstalledListDependencies,
  type InstalledListV1,
} from './installed-list'

export type ListOpts = KernelCommandOpts &
  AdminTargetCommandOpts &
  RawOutputOpts & {
    format?: 'yaml' | 'json'
  }

/**
 * `astrale domain list -i <instance>` / `--url <kernel>`: what runs on that instance (CT24
 * InstalledListV1). A person gets the [.79737] table on a TTY; --json, --ci or a pipe print the
 * document. A refusal exits 1, with its details in machine mode.
 */
export async function runInstalledList(
  opts: ListOpts,
  dependencies: Partial<InstalledListDependencies> = {},
): Promise<void> {
  const machine = isMachine(opts)
  let list: InstalledListV1
  try {
    list = await withSpinner('Reading installed Domains', !machine, () =>
      listInstalled(opts, dependencies),
    )
  } catch (error) {
    if (error instanceof AstraleError) fatal(error, opts)
    await formatKernelError(error, machine, undefined, opts.debug)
    process.exit(1)
  }
  if (machine) output(list, opts)
  else console.log(renderInstalled(list))
}

export default {
  name: 'list',
  description: 'List the installed domains readable on the selected instance',
  afterHelpText: `
Behavior:
  Lists what runs on the selected instance (-i/--url, or the active instance):
  every installation the instance Kernel pins to a deployment and that the
  caller can read. ORIGIN, then VERSION, DIGEST and AVAILABLE:
    DIGEST     the pinned release digest, from the Kernel.
    VERSION    the registry version naming that exact release; else the
               version naming the same build from the same issuer, in the
               deployment's environment (1.5.0 · staging); else the
               deployment's name from its public record (1.4.2 + 7 commits ·
               a1b2c3d · staging), printed as computed; "unknown" when
               nothing names it.
    AVAILABLE  the highest stable, non-yanked version above the installed
               one (or above the release a preview was built after).
  Versions come from the Admin registry, read as the caller (--as, or the
  default identity; --admin/--admin-url choose the Admin kernel). --creds
  and --anonymous authenticate the instance only and never reach Admin.
  The registry is opened only when a release pin needs a version, and a
  registry that cannot be read fails the command.
  The listing is partial by nature: built-in and local Domains are never
  listed, nor Domains the caller cannot read, so an absent origin is
  unknown, not "not installed". --json, --ci or a pipe print one
  astrale.installed-list document.

Examples:
  $ astrale domain list -i acme-prod
  $ astrale domain list -i acme-prod --json
  $ astrale domain list
`,
  options: [...ADMIN_TARGET_OPTIONS],
  action: async (opts: ListOpts) => {
    await runInstalledList(opts)
  },
} satisfies CommandDefinition
