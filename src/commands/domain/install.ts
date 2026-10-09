import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program/index'
import type { ReferenceInstallOpts } from './release-install'

import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { installByReference } from './release-install'

type InstallOpts = KernelCommandOpts &
  AdminTargetCommandOpts &
  ReferenceInstallOpts & {
    // Programmatic opt-out for callers that drive this command as a function.
    // The matching CLI flags are read from argv by `canPrompt` — Commander
    // keeps root options out of a subcommand's action arguments.
    ci?: boolean
    noPrompt?: boolean
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

  Before installing, the CLI reads what each URL serves (release.json),
  refuses two references to the same origin, and pins the
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
  version reference fails before any install. URLs alone read Admin only to
  propose a compatible version of a dependent the pre-check finds broken.

  Before the install is sent, a pre-check runs the Kernel's compatibility
  engine on what you can read, in both directions: each Domain you install
  must find what it uses in its dependencies as the install leaves them, and
  each installed Domain you do not name must still find what it uses in every
  dependency you upgrade. A Domain whose installed schema you cannot read is
  reported as not evaluated. For each installed dependent it finds broken, the
  CLI proposes the highest stable, non-yanked published version built against
  the new revision, and the grouped install that adds them. The pre-check is
  advisory: the install is still sent and the Kernel decides. --json carries
  it as the "precheck" member of the report, and of a refusal for dependency
  or dependent compatibility.

  An issuer change is never silent. When a URL serves another issuer than the
  one its origin is installed under, the install needs consent, which the
  Kernel records in the installation:
    - a new deployment of the same line (same <line>- prefix and routing
      domain): --allow-issuer-change;
    - any other change: --allow-issuer-change=<origin>;
    - or, at a terminal, typing the origin to confirm.
  The replaced issuer keeps working while its in-flight work drains;
  --revoke-previous cuts it at the activation instead. The first install of an
  origin from a deployment URL needs no consent: the CLI notes that the
  deployment claims the origin, unverified.

Examples:
  $ astrale domain install issues.astrale.ai@1.5 -i acme-prod            # highest stable 1.5.x
  $ astrale domain install crm.acme.dev@1.5.0 https://employees.example -i staging  # mixed, atomic
  $ astrale domain install https://crm.workers.dev -i staging            # one URL, to the instance kernel
  $ astrale domain install https://agencies.example https://employees.example -i staging  # grouped, atomic
  $ astrale domain install <new-deployment-url> --allow-issuer-change -i staging   # same line
  $ astrale domain install <deployment-url> --allow-issuer-change=crm.acme.dev -i staging  # other line
  $ astrale domain install http://localhost:8787 --token "$INSTALL_TOKEN" # private Domain on a local Host
`,
  arguments: [
    {
      name: 'references',
      description: 'Deployment URLs and versions (<origin>@<version>) to install together',
      required: true,
      variadic: true,
    },
  ],
  options: [
    ...ADMIN_TARGET_OPTIONS,
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
  ],
  action: async (references: [string, ...string[]], opts: InstallOpts) => {
    await installByReference(references, opts)
  },
} satisfies CommandDefinition
