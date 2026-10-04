import chalk from 'chalk'

import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program/index'
import type { UrlInstallOpts } from './release-install'

import { withAdminClientSession } from '../../connection'
import { formatKernelError } from '../../connection/errors'
import { AstraleError } from '../../errors'
import {
  installAdminDomainInContext,
  listAdminDomainsInContext,
  type DomainInfo,
} from '../../lib/admin-domain'
import {
  listOwnedInstancesInContext,
  resolveOwnedInstanceInContext,
  type OwnedInstanceInfo,
} from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { getActive } from '../../lib/instance'
import { canPrompt } from '../../lib/interactive'
import { fatal, log, withSpinner } from '../../lib/log'
import { isMachine, output } from '../../lib/output'
import { promptText, selectFrom } from '../../lib/prompt'
import { installByUrl } from './release-install'

type InstallOpts = KernelCommandOpts &
  AdminTargetCommandOpts &
  UrlInstallOpts & {
    direct?: boolean
    // Programmatic opt-out for callers that drive this command as a function.
    // The matching CLI flags are read from argv by `canPrompt` — Commander
    // keeps root options out of a subcommand's action arguments.
    ci?: boolean
    noPrompt?: boolean
  }

/**
 * A URL reference is one that starts with `https://` or `http://` (a local Host): it names one
 * deployment and goes to the instance Kernel. Anything else is a Fleet catalog origin.
 */
export function isUrlReference(reference: string): boolean {
  return reference.startsWith('https://') || reference.startsWith('http://')
}

/**
 * Whether the references go to the instance Kernel: every reference is a URL, or the deprecated
 * `--direct` names that route, so even a URL the reference grammar does not read (an upper-case
 * scheme) never reaches the Fleet catalog; `installByUrl` then admits or refuses it.
 */
export function installsOnKernel(references: readonly string[], direct: boolean): boolean {
  return references.length > 0 && (direct || references.every(isUrlReference))
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

  The identity-override consent gate runs for each URL: when a Domain's declared
  origin differs from its serving host, it requires explicit consent (an
  interactive DANGER prompt, or --allow-identity-override in scripts).

  A bare origin installs one PUBLISHED domain from the Fleet catalog through the
  admin control plane (DomainEntry.install); run the command bare to pick from
  the catalog interactively. The target instance must then be admin-managed.

  A fresh, strong operation id is generated automatically. Use --operation
  only to retry or recover the exact same URL install after an outcome-unknown
  timeout or disconnect.

  --direct is deprecated and changes nothing: URL references always go to the
  instance Kernel. It is still accepted for scripts written before, and is
  removed in a later breaking release.

Examples:
  $ astrale domain install https://crm.workers.dev -i staging            # one URL, to the instance kernel
  $ astrale domain install https://agencies.example https://employees.example -i staging  # grouped, atomic
  $ astrale domain install http://localhost:8787 --token "$INSTALL_TOKEN" # private Domain on a local Host
  $ astrale domain install crm.acme.dev -i staging                         # by origin, from the Fleet catalog
  $ astrale domain install                                                 # interactive: pick domain + instance
`,
  arguments: [
    {
      name: 'references',
      description:
        'Deployment URLs to install together, or one catalog origin (omit to pick from the catalog interactively)',
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
      description: 'Reuse an exact URL-install operation id for explicit retry/recovery',
    },
    {
      flags: '--allow-identity-override',
      description:
        'Consent to a domain whose origin differs from its serving host (URL references)',
    },
  ],
  action: async (references: string[] | undefined, opts: InstallOpts) => {
    const named = references ?? []
    if (installsOnKernel(named, opts.direct === true)) {
      await installByUrl(named as [string, ...string[]], opts)
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
          'A catalog origin installs alone; only deployment URLs install together.',
          'Install the catalog origin on its own, or name every Domain by its deployment URL.',
        )
      }
      if (opts.operation !== undefined) {
        throw new AstraleError(
          'INVALID_FLAG',
          '--operation is valid only with URL references.',
          'URL installs generate a fresh operation id automatically.',
        )
      }
    } catch (error) {
      fatal(error, opts)
    }
    await installViaAdmin(named[0], opts)
  },
} satisfies CommandDefinition

// ── Admin path (default) ──────────────────────────────────────────────────────

/**
 * Install a published domain through the admin control plane. The domain is
 * addressed by its catalog `origin` (the registry key); a deployment URL goes to
 * the instance Kernel instead (`installByUrl`). The target instance is the
 * active one or `-i <slug>` and must be admin-managed.
 *
 * `-i` here means the INSTALL TARGET, not the admin target — so it is stripped
 * before resolving the admin client (which would otherwise read `-i`/`--url` as
 * an admin-kernel override). The admin kernel is chosen via --admin/--admin-url
 * or config, exactly like `domain publish`.
 */
export async function installViaAdmin(
  target: string | undefined,
  opts: InstallOpts,
  dependencies: Partial<AdminInstallDependencies> = {},
): Promise<void> {
  const admin = { ...defaultAdminInstallDependencies, ...dependencies }
  const interactive = canPrompt(opts)
  if (!target && !interactive) {
    fatal(
      new AstraleError(
        'MISSING_ARG',
        'No domain given and no TTY for interactive selection.',
        'Pass a catalog origin or a deployment URL, e.g. astrale domain install crm.acme.dev',
      ),
    )
  }
  // Strip the install-target selector so the admin client resolves only the
  // admin kernel (via --admin/--admin-url/config), not the instance under `-i`.
  const adminOpts = {
    admin: opts.admin,
    adminUrl: opts.adminUrl,
    timeout: opts.timeout,
    as: opts.as,
    creds: opts.creds,
  }

  try {
    await withAdminClientSession(adminOpts, async (ctx) => {
      const requested = opts.instance ?? (target === undefined ? undefined : await activeSlug())
      const instances = requested === undefined ? await admin.listInstances(ctx) : []
      const slug = requested ?? (await resolveTargetSlug(opts, target, interactive, instances))

      const match =
        instances.find((i) => i.slug === slug) ?? (await admin.resolveInstance(ctx, slug))
      if (!match) {
        throw new AstraleError(
          'INSTANCE_NOT_MANAGED',
          `Instance "${slug}" is not available through Admin.`,
          `Install the deployment URL onto it instead: astrale domain install <url> -i ${slug}`,
        )
      }
      assertInstallTargetReady(match)

      const domains = await admin.listDomains(ctx, match.id)
      const domain = await resolveDomain(domains, target, interactive)

      const label = domain.origin
      const result = await withSpinner(
        `Installing ${label} on ${match.slug}`,
        !isMachine(opts),
        () => admin.install(ctx, match, domain),
        { success: (r) => `Installed ${r.origin} on ${match.slug}` },
      )

      if (isMachine(opts)) {
        output(result, opts)
        return
      }
      // The admin returns install failures as `ok:false` (it never throws past
      // the saga). Surface them loudly rather than printing a quiet success.
      if (!result.ok) {
        throw new AstraleError(
          'INSTALL_FAILED',
          `Install failed on ${match.slug}: ${result.error ?? 'unknown error'}`,
        )
      }
      log.dim(`  origin: ${result.origin}`)
      log.dim(`  url:    ${result.url}`)
    })
  } catch (error) {
    await formatKernelError(error, isMachine(opts), undefined, opts.debug)
    process.exit(1)
  }
}

function assertInstallTargetReady(instance: OwnedInstanceInfo): void {
  if (instance.state === 'ready') return
  const detail = instance.phase && instance.phase !== instance.state ? ` (${instance.phase})` : ''
  throw new AstraleError(
    'INSTANCE_NOT_READY',
    `Instance "${instance.slug}" is ${instance.state}${detail}; domains cannot be installed yet.`,
    instance.error ?? `Run: astrale instance status ${instance.slug}`,
  )
}

/** Resolve the domain to install: the positional `target`, or an interactive pick. */
async function resolveDomain(
  catalog: readonly DomainInfo[],
  target: string | undefined,
  interactive: boolean,
): Promise<DomainInfo> {
  if (target) {
    const found = catalog.find((domain) => domain.origin === target)
    if (found !== undefined) return found
    throw new AstraleError(
      'DOMAIN_NOT_FOUND',
      `No published domain matches "${target}".`,
      'Run `astrale domain list` to see the Admin catalog.',
    )
  }
  if (!interactive) throw new AstraleError('MISSING_ARG', 'No domain given.')

  const installable = catalog.filter((d) => d.url)
  if (installable.length === 0) {
    throw new AstraleError(
      'EMPTY_CATALOG',
      'No published domains in the admin catalog.',
      'Publish one first: astrale domain publish --origin … --name … --public-url …',
    )
  }
  const origin = await selectFrom(
    'Select a domain to install',
    installable.map((d) => ({
      label: `${d.name}  ${chalk.dim(`${d.origin} → ${d.url}`)}`,
      value: d.origin,
    })),
  )
  if (!origin) throw new AstraleError('CANCELLED', 'No domain selected.')
  return catalog.find((domain) => domain.origin === origin)!
}

interface AdminInstallDependencies {
  readonly resolveInstance: typeof resolveOwnedInstanceInContext
  readonly listInstances: typeof listOwnedInstancesInContext
  readonly listDomains: typeof listAdminDomainsInContext
  readonly install: typeof installAdminDomainInContext
}

const defaultAdminInstallDependencies: AdminInstallDependencies = Object.freeze({
  resolveInstance: resolveOwnedInstanceInContext,
  listInstances: listOwnedInstancesInContext,
  listDomains: listAdminDomainsInContext,
  install: installAdminDomainInContext,
})

/**
 * Resolve the target instance slug: `-i`, else the active instance. When run
 * bare (no positional) in a TTY, prompt for it with the active instance
 * pre-filled (Enter accepts) and validated against the managed list.
 */
async function resolveTargetSlug(
  opts: InstallOpts,
  target: string | undefined,
  interactive: boolean,
  instances: OwnedInstanceInfo[],
): Promise<string> {
  if (opts.instance) return opts.instance
  const active = await activeSlug()

  if (target === undefined && interactive) {
    const slugs = instances.map((i) => i.slug)
    if (slugs.length > 0) log.dim(`  managed instances: ${slugs.join(', ')}`)
    const chosen = await promptText('Instance to install on', {
      default: active && slugs.includes(active) ? active : undefined,
      validate: (v) =>
        slugs.includes(v) ||
        `unknown managed instance "${v}" (one of: ${slugs.join(', ') || 'none'})`,
    })
    if (!chosen) throw new AstraleError('CANCELLED', 'No instance selected.')
    return chosen
  }

  if (!active) {
    throw new AstraleError(
      'NO_TARGET_INSTANCE',
      'No target instance: none active and no -i <slug> given.',
      'Pass -i <slug>, or select one with astrale instance use <slug>.',
    )
  }
  return active
}

/** The active instance's slug (its admin-side id), or undefined when none. */
async function activeSlug(): Promise<string | undefined> {
  try {
    const a = await getActive()
    return a.slug ?? a.name
  } catch {
    return undefined
  }
}
