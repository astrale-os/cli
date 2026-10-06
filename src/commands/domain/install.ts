import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program/index'
import type { ReferenceInstallOpts } from './release-install'

import { AstraleError } from '../../errors'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { fatal } from '../../lib/log'
import { installViaAdmin } from './legacy/catalog-install'
import { installByReference } from './release-install'
import { isVersionReference } from './version-reference'

type InstallOpts = KernelCommandOpts &
  AdminTargetCommandOpts &
  ReferenceInstallOpts & {
    direct?: boolean
    // Programmatic opt-out for callers that drive this command as a function.
    // The matching CLI flags are read from argv by `canPrompt` — Commander
    // keeps root options out of a subcommand's action arguments.
    ci?: boolean
    noPrompt?: boolean
  }

/**
 * A URL reference is one that starts with `https://` or `http://` (a local Host): it names one
 * deployment and goes to the instance Kernel. A version reference (`<origin>@<version>`) names a
 * published version and goes to the instance Kernel once Admin's registry resolved it. Anything
 * else is a Fleet catalog origin.
 */
export function isUrlReference(reference: string): boolean {
  return reference.startsWith('https://') || reference.startsWith('http://')
}

/**
 * Whether the references go to the instance Kernel: every reference is a URL or a version, or the
 * deprecated `--direct` names that route, so even a URL the reference grammar does not read (an
 * upper-case scheme) never reaches the Fleet catalog; `installByReference` then admits or refuses
 * it.
 */
export function installsOnKernel(references: readonly string[], direct: boolean): boolean {
  return (
    references.length > 0 &&
    (direct ||
      references.every((reference) => isUrlReference(reference) || isVersionReference(reference)))
  )
}

export default {
  name: 'install',
  description: 'Install one or more domains on an instance in one atomic Kernel operation',
  afterHelpText: `
Behavior:
  URL references (https://, or http:// for a local Host) go straight to the
  instance Kernel through the public install syscall, on any instance you can
  authenticate to (managed, bookmarked, or local), with your own authority.
  Several URLs install together in ONE atomic Kernel operation: either every
  Domain moves, or none does. Use it when Domains depend on each other.

  Before installing, the CLI reads what each URL serves (release.json, else the
  legacy domain.json), refuses two references to the same origin, and pins the
  exact release digest it read, so the Kernel refuses anything else. After the
  install, it reads the installed releases back and verifies each pin. A
  deployment that answers 503 (not serving yet) to that read is read again for
  up to 60 s; a Kernel refusal of the install itself is never resent.

  A version reference names a published version instead of a URL: the syntax
  decides, a version goes to the registry and a URL is installed as is.
    - <origin>@1.5.0 (or @2.0.0-rc.1): exactly that version, a pre-release or
      a yanked one included (a yanked version installs with a warning);
    - <origin>@1.5: the highest stable 1.5.x that is not yanked.
  A major alone (@1), a range or build metadata is refused. The CLI reads the
  Domain's Publications in the Admin registry (--admin / --admin-url, or the
  configured Admin target) with your own identity: a private Domain needs
  domain_installer (or domain_admin), held directly or through a Group, and
  one you cannot read is reported as not found. The version becomes its
  Publication's deployment URL and release digest: the CLI checks that the
  deployment still serves that release, and the Kernel refuses any other.
  Versions and URLs mix in one atomic install. If Admin cannot answer, a
  version reference fails before any install; URLs alone never read Admin. A
  Kernel that does not list installed releases cannot pin a version: install
  the deployment URL there.

  An issuer change is never silent. When a URL serves another issuer than the
  one its origin is installed under, the install needs consent, which the
  Kernel records in the installation:
    - a new deployment of the same line (same <line>- prefix and routing
      domain): --allow-issuer-change;
    - any other change, a legacy issuer moving to its first deployment
      included: --allow-issuer-change=<origin>;
    - or, at a terminal, typing the origin to confirm.
  The replaced issuer keeps working while its in-flight work drains;
  --revoke-previous cuts it at the activation instead. The first install of an
  origin from a deployment URL needs no consent: the CLI notes that the
  deployment claims the origin, unverified.

  A source that serves only the legacy domain.json, and every URL install on a
  Kernel that does not list installed releases, keep the identity-override
  gate: when a Domain's declared origin differs from its serving host, it
  requires explicit consent (an interactive DANGER prompt, or
  --allow-identity-override in scripts). Such a Kernel takes no issuer
  consent: --allow-issuer-change is refused there before any install.

  Deprecated: a bare origin installs one PUBLISHED domain from the Fleet catalog
  through the admin control plane (Instance.installDomain); run the command bare
  to pick from the catalog interactively. The target instance must then be
  admin-managed. Install a version (<origin>@<version>) or a deployment URL
  instead; the Fleet catalog now only keeps a Fleet's default Domains.

  A fresh, strong operation id is generated automatically. Use --operation
  only to retry or recover the exact same install after an outcome-unknown
  timeout or disconnect; the retry command the CLI prints names each version
  exactly as it resolved, never the line it was asked for.

  --direct is deprecated and changes nothing: URL references always go to the
  instance Kernel. It is still accepted for scripts written before, and is
  removed in a later breaking release.

Examples:
  $ astrale domain install issues.astrale.ai@1.5 -i acme-prod            # highest stable 1.5.x
  $ astrale domain install crm.acme.dev@1.5.0 https://employees.example -i staging  # mixed, atomic
  $ astrale domain install https://crm.workers.dev -i staging            # one URL, to the instance kernel
  $ astrale domain install https://agencies.example https://employees.example -i staging  # grouped, atomic
  $ astrale domain install <new-deployment-url> --allow-issuer-change -i staging   # same line
  $ astrale domain install <deployment-url> --allow-issuer-change=crm.acme.dev -i staging  # other line
  $ astrale domain install http://localhost:8787 --token "$INSTALL_TOKEN" # private Domain on a local Host
  $ astrale domain install crm.acme.dev -i staging                         # deprecated: by origin, from the Fleet catalog
  $ astrale domain install                                                 # deprecated: pick from the Fleet catalog
`,
  arguments: [
    {
      name: 'references',
      description:
        'Deployment URLs and versions (<origin>@<version>) to install together, or (deprecated) one Fleet catalog origin (omit to pick from the catalog interactively)',
      required: false,
      variadic: true,
    },
  ],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    // @deprecated (legacy, plan C1): `--direct` names the route URL references always take now.
    // Short-term consumer: 1Pact developer machines running the newest global CLI, whose sdk
    // 0.6.0-beta.0 `reconcile` execs `domain install <url> --direct --allow-identity-override -i
    // <instance>`. Removal: D13, with `legacy/publication-install.ts` (this option, the MISSING_ARG
    // branch below and the `direct` term of `installsOnKernel`).
    {
      flags: '--direct',
      description:
        'Deprecated: URL references always install onto the instance kernel; accepted for older scripts',
    },
    {
      flags: '--token <token>',
      description: 'Bearer token for a private domain delivery endpoint (one URL reference only)',
    },
    {
      flags: '--operation <uuid>',
      description: 'Reuse an exact install operation id for explicit retry/recovery',
    },
    {
      flags: '--allow-issuer-change [origin]',
      description:
        'Consent to an issuer change: bare, every new deployment of the same line; --allow-issuer-change=<origin>, any change of that origin (repeatable; the origin only after =)',
      repeatable: true,
    },
    {
      flags: '--revoke-previous',
      description:
        'With an issuer change, cut the replaced issuer at the activation instead of draining it',
    },
    // @deprecated (legacy, plan C2): the identity-override gate of `legacy/identity-override.ts`,
    // for sources that serve only domain.json and Kernels without the `installed` listing. Short-term
    // consumer: 1Pact developer machines (sdk 0.6.0-beta.0 `reconcile` passes it against the beta.117
    // Host). Removal: D15.
    {
      flags: '--allow-identity-override',
      description:
        '(deprecated, removal D15; see --allow-issuer-change) Consent to a legacy domain.json source whose origin differs from its serving host',
    },
  ],
  action: async (references: string[] | undefined, opts: InstallOpts) => {
    const named = references ?? []
    if (installsOnKernel(named, opts.direct === true)) {
      await installByReference(named as [string, ...string[]], opts)
      return
    }
    try {
      if (opts.direct) {
        throw new AstraleError(
          'MISSING_ARG',
          '--direct requires a domain url.',
          'e.g. astrale domain install https://crm.acme.dev',
        )
      }
      if (named.length > 1) {
        throw new AstraleError(
          'MIXED_REFERENCES',
          'A catalog origin installs alone; only deployment URLs and versions (<origin>@<version>) install together.',
          'Install the catalog origin on its own, or name every Domain by a version or its deployment URL.',
        )
      }
      if (opts.operation !== undefined) {
        throw new AstraleError(
          'INVALID_FLAG',
          '--operation is valid only with URL or version references.',
          'URL and version installs generate a fresh operation id automatically.',
        )
      }
      if (opts.allowIssuerChange !== undefined || opts.revokePrevious === true) {
        throw new AstraleError(
          'INVALID_FLAG',
          '--allow-issuer-change and --revoke-previous are valid only with URL or version references.',
          'Install the deployment URL to consent to an issuer change, e.g. astrale domain install https://… --allow-issuer-change=<origin>',
        )
      }
    } catch (error) {
      fatal(error, opts)
    }
    await installViaAdmin(named[0], opts)
  },
} satisfies CommandDefinition
