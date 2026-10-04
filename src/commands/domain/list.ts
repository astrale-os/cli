import type { CommandDefinition } from '../../program/index'

import { ADMIN_TARGET_OPTIONS, FLEET_OPTION } from '../../lib/admin-target'
import { listFleetCatalog, type CatalogListOpts } from './legacy/catalog-list'

export default {
  name: 'list',
  description: 'List the domains of the Fleet catalog (deprecated: see domain versions)',
  afterHelpText: `
Deprecated:
  The Fleet catalog now only keeps a Fleet's default Domains (what every new
  instance of the Fleet receives), until provisioning by version replaces it.
  \`astrale domain versions <origin>\` lists the published versions of a
  Domain; \`astrale domain install <origin>@<version>\` installs one.

Behavior:
  Reads the admin catalog — every domain that has been \`publish\`ed
  (origin → published worker URL). Listing only shows what is INSTALLABLE;
  what is actually mounted where lives on each instance's own graph
  (\`astrale query\` against that instance).

  Default output is a NAME/ORIGIN/URL/DEFAULT table on a TTY, JSON when piped
  or with --json/--raw (agent-friendly — full DomainInfo objects). -q prints
  one install URL per line (pipeable into \`domain install\`); --count prints
  only the number. --default-only keeps the install-by-default entries (what
  every new instance receives during Admin-managed provisioning). --check probes each published URL's
  canonical Publication and adds a live/unreachable STATUS column
  (+ reachable/schemaRevision in machine output).

  The admin kernel is selected like every admin op — the configured default,
  or --admin <bookmark> / --admin-url <url>. -i and --url are rejected: they
  select an instance, and this command reads the Admin catalog.

Examples:
  $ astrale domain list
  $ astrale domain list --check
  $ astrale domain list --default-only -q
  $ astrale domain list --json | jq -r '.[].url'
`,
  options: [
    ...ADMIN_TARGET_OPTIONS,
    FLEET_OPTION,
    {
      flags: '--check',
      description: "Probe each domain's canonical Publication + schema revision",
    },
    { flags: '--default-only', description: 'Only show install-by-default domains' },
    { flags: '-q, --quiet', description: 'One install URL per line (unix-pipeable)' },
    { flags: '--count', description: 'Print only the number of published domains' },
    { flags: '-l, --long', description: 'Full catalog records in machine output' },
  ],
  action: (opts: CatalogListOpts) => listFleetCatalog(opts),
} satisfies CommandDefinition
