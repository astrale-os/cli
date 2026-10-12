import type { CommandDefinition } from '../../program/index'

import { ADMIN_TARGET_OPTIONS } from '../../lib/admin/target'
import { installByReference, type ReferenceInstallOpts } from './release-install'

export default {
  name: 'install',
  description: 'Install one or more domains on an instance in one atomic Kernel operation',
  afterHelpText: `
Behavior:
  Installation is durable. The CLI waits within --timeout in online mode and
  reports success only after completion. An installation that ended failed
  exits 2, one refused as an operation conflict or while another schema change
  is active (SCHEMA_CHANGE_ACTIVE) exits 5, any other failure exits 1. One
  still running when the CLI stops waiting (--timeout, or --no-wait) is no
  failure: the CLI prints its execution and the commands that follow it and
  exits 0 (--json on stdout: no "changed", "follow" waits for it). --json
  retains its execution ID and exact status.
  An operation names one request and its outcome is final. Follow an
  installation by its execution ("observe": installation status, "follow":
  installation result --wait-ms); once it ended (failed or cancelled), try
  again without --operation ("fresh"). A refusal before any execution exists
  (--json: "execution": null) leaves the operation unused. --no-wait returns
  without waiting. Ctrl-C stops waiting, never the installation: the CLI names
  the execution that continues and exits 130.
  --operation is for automation: a reused id replays only the exact same
  request, and the Kernel marks that answer a replay (--json: "replayed",
  only as it sends it); the CLI then says once that the operation already ran
  and this is its recorded outcome. Any other request under that id is
  refused as an operation conflict: nothing runs, the CLI names the execution
  the id belongs to and how it stands, and exits 5. The same command can
  conflict too, when it is planned again from a state its first run moved.

  --mode maintenance opens a Root-only repair session; other callers are
  blocked while it is open. The CLI watches it within --timeout while it
  drains the Instance, until it awaits its first command, then prints the
  commands it accepts and exits 0 (--no-wait: no watch). It waits for explicit
  Execution signals, not for this CLI process. Retain its execution ID,
  inspect its status and repair the data before applying the target with
  domain installation apply. Never delete or force-cancel it as a normal
  recovery step: those actions can leave the source schema uncertified.

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
  $ astrale domain installation status <execution-id> -i staging --as root --json
  $ astrale domain installation apply <execution-id> --command 1 -i staging --as root --json
  $ astrale domain installation result <execution-id> --wait-ms 10000 -i staging --as root --json
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
      flags: '--mode <mode>',
      description: 'Online install (default), or a Root-only maintenance repair session',
      choices: ['online', 'maintenance'],
    },
    {
      flags: '--validation-scope <scope>',
      description: 'Validate incrementally (default) or revalidate all retained data',
      choices: ['incremental', 'full'],
    },
    {
      flags: '--validation-counts <counts>',
      description: 'Sample failures (default) or count all validation failures',
      choices: ['sample', 'exact'],
    },
    {
      flags: '--no-wait',
      description: 'Return the durable execution state without waiting for completion',
    },
    {
      flags: '--token <token>',
      description: 'Bearer token for a private domain delivery endpoint (one URL reference only)',
    },
    {
      flags: '--operation <uuid>',
      description: 'Operation id for automation; a reused id replays only the same request',
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
  action: async (references: [string, ...string[]], opts: ReferenceInstallOpts) => {
    await installByReference(references, opts)
  },
} satisfies CommandDefinition
