import chalk from 'chalk'

import type { RegistryIndexV1 } from '../../admin/registry'
import type { CommandDefinition } from '../../program/index'
import type { RegistryCommandDependencies, RegistryCommandOpts } from '../domain-registry/shared'

import { registryOrigin } from '../../admin/registry'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { isMachine } from '../../lib/output'
import { renderTable } from '../../lib/table'
import { runRegistryCommand } from '../domain-registry/shared'

/** The human listing of Résolution [.79737]: version, release digest, and what keeps it apart. */
export function versionRows(index: RegistryIndexV1): Array<Record<string, string>> {
  return index.publications.map((publication) => ({
    version: publication.version,
    digest: shortDigest(publication.releaseDigest),
    status: [
      publication.version.includes('-') ? 'pre-release' : '',
      publication.yanked ? 'yanked' : '',
    ]
      .filter((token) => token !== '')
      .join(', '),
  }))
}

export function renderVersions(index: RegistryIndexV1): string {
  if (index.publications.length === 0)
    return chalk.dim(`  ${index.origin} has no published version yet.`)
  return renderTable(versionRows(index), {
    columns: [
      { key: 'version', header: 'VERSION', color: chalk.bold },
      { key: 'digest', header: 'RELEASE', color: chalk.dim },
      { key: 'status', header: 'STATUS', color: chalk.yellow },
    ],
  })
}

/** `sha256:` and the first 12 hex digits: enough to tell releases apart on one screen. */
function shortDigest(digest: string): string {
  return `${digest.slice(0, 'sha256:'.length + 12)}…`
}

export async function runVersions(
  origin: string,
  opts: RegistryCommandOpts,
  dependencies?: RegistryCommandDependencies,
): Promise<number> {
  return runRegistryCommand({
    opts,
    machine: isMachine(opts),
    action: 'read',
    admit: () => registryOrigin(origin),
    work: (registry, admitted) => registry.index(admitted),
    present: (index) => console.log(renderVersions(index)),
    ...(dependencies === undefined ? {} : { dependencies }),
  })
}

export default {
  name: 'versions',
  description: 'List the published versions of a Domain in the Admin registry',
  arguments: [
    { name: 'origin', description: 'Domain origin, e.g. issues.astrale.ai', required: true },
  ],
  afterHelpText: `
Behavior:
  Reads every Publication of the Domain the caller may read from the Admin
  registry, in one Query with the caller's own credential: a Domain is
  readable by its domain_admin and domain_installer holders (a User or a
  Group, CI included). Pre-releases and yanked versions are listed; a
  yanked version is never chosen by a line reference such as @1.5.

  A Domain that is absent and one the caller may not read are the same
  answer, REGISTRY_DOMAIN_NOT_FOUND. Nothing is installed or changed.

  The table shows VERSION, RELEASE (release digest) and STATUS
  (pre-release, yanked) on a TTY. --json, --ci or a pipe print one
  astrale.registry-index document; a refusal prints
  { "error": { "code", "message", "details" } } and exits 1.

Examples:
  $ astrale domain versions issues.astrale.ai
  $ astrale domain versions issues.astrale.ai --json
  $ astrale domain versions issues.astrale.ai --admin-url https://admin.example.com/api --as ci
`,
  options: [...ADMIN_TARGET_OPTIONS],
  action: async (origin: string, opts: RegistryCommandOpts) => {
    const code = await runVersions(origin, opts)
    if (code !== 0) process.exit(code)
  },
} satisfies CommandDefinition
