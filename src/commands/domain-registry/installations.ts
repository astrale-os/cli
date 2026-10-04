import type { AdminFleetApi, FleetInstallationsV1 } from '../../admin/fleet'
import type { CommandDefinition } from '../../program/index'
import type { RegistryCommandOpts } from './shared'

import { connectAdminFleet, releaseFilter } from '../../admin/fleet'
import { registryOrigin } from '../../admin/registry'
import { registryFailure } from '../../admin/registry/failure'
import { withAdminClientSession } from '../../connection'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { printFailureDebug } from '../../lib/failure-debug'
import { registryErrorDocument } from './shared'

type InstallationsOpts = RegistryCommandOpts & { readonly release?: readonly string[] }

export interface InstallationsDependencies {
  /** Opens the configured Admin target with the caller's own credential. */
  readonly open?: <Value>(
    opts: RegistryCommandOpts,
    work: (fleet: AdminFleetApi) => Promise<Value>,
  ) => Promise<Value>
  readonly write?: (text: string) => void
}

/**
 * `astrale __domain-registry installations <origin> [--release <digest>]...` (CT24 over CT37): print
 * one `astrale.fleet-installations` document, every page of `Fleet.installations` joined, and
 * answer 0; or print one `{ error: { code, message, details? } }` document and answer 1. The
 * arguments are admitted before Admin is opened. A caller Admin gives no Fleet view (2004) gets
 * `fleetView: false` and exit 0: no view is not an error (AM-198).
 */
export async function runInstallations(
  origin: string,
  opts: InstallationsOpts,
  dependencies: InstallationsDependencies = {},
): Promise<number> {
  const open = dependencies.open ?? openFleet
  const write = dependencies.write ?? ((text: string) => void process.stdout.write(text))
  let document: FleetInstallationsV1
  try {
    const admitted = registryOrigin(origin)
    const releases =
      opts.release === undefined || opts.release.length === 0
        ? undefined
        : releaseFilter(opts.release)
    document = await open(opts, (fleet) =>
      fleet.installations(admitted, releases === undefined ? {} : { releases }),
    )
  } catch (cause) {
    write(`${JSON.stringify(registryErrorDocument(registryFailure(cause, 'read')), null, 2)}\n`)
    if (opts.debug) printFailureDebug(cause, '')
    return 1
  }
  write(`${JSON.stringify(document, null, 2)}\n`)
  return 0
}

function openFleet<Value>(
  opts: RegistryCommandOpts,
  work: (fleet: AdminFleetApi) => Promise<Value>,
): Promise<Value> {
  return withAdminClientSession(opts, async (context) => work(connectAdminFleet(context)))
}

export default {
  name: 'installations',
  description: 'List the Instances of your administered Fleets that pin a Domain (plumbing)',
  arguments: [
    { name: 'origin', description: 'Domain origin, e.g. issues.astrale.ai', required: true },
  ],
  options: [
    {
      flags: '--release <digest>',
      description: 'Only the Instances pinned to this release digest (repeatable)',
      repeatable: true,
    },
    ...ADMIN_TARGET_OPTIONS,
  ],
  action: async (origin: string, opts: InstallationsOpts) => {
    const code = await runInstallations(origin, opts)
    if (code !== 0) process.exit(code)
  },
} satisfies CommandDefinition
