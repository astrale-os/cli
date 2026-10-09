/**
 * The deprecation notice of the Fleet catalog commands (`domain publish`, `domain list`, the
 * bare-origin `domain install`), each naming its successor.
 *
 * @deprecated Removed with the commands it announces: see `./fleet-catalog.ts`.
 */
import type { MachineOpts } from '../../../lib/output'

import { log } from '../../../lib/log'
import { isMachine } from '../../../lib/output'

/** The deprecation notice each Fleet catalog command prints for a person, naming its successor. */
export const FLEET_CATALOG_DEPRECATION = Object.freeze({
  publish:
    "`astrale domain publish` is deprecated: the Fleet catalog it writes now only keeps a Fleet's default Domains. " +
    'Publish a version with `astrale-domain publish <environment>` in the Domain project.',
  list:
    '`astrale domain list` without -i/--url reads the deprecated Fleet catalog. ' +
    '`astrale domain versions <origin>` lists the published versions of a Domain.',
  install:
    'Installing from the Fleet catalog by origin is deprecated. ' +
    'Install a published version (`astrale domain install <origin>@<version>`) or a deployment URL.',
})

/**
 * Warn a person that a Fleet catalog command is deprecated, on stderr. Machine runs (--json, --ci,
 * --raw, or no terminal on stdout) get nothing, so their stdout and stderr stay what scripts parse:
 * adapter-astrale 0.5.0-beta.148 reads a failed `domain install`'s stderr as exactly one JSON value.
 */
export function warnFleetCatalogDeprecated(
  command: keyof typeof FLEET_CATALOG_DEPRECATION,
  opts: MachineOpts,
): void {
  if (!isMachine(opts)) log.warn(FLEET_CATALOG_DEPRECATION[command])
}
