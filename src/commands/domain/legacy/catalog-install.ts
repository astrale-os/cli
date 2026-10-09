/**
 * The bare-origin `astrale domain install <origin>` (or bare `astrale domain install` at a
 * terminal): install one entry of the Fleet catalog on an Admin-managed Instance through
 * `Instance.installDomain`.
 *
 * @deprecated Successor: `astrale domain install <origin>@<version>` or a deployment URL, which
 * the CLI installs through the instance Kernel itself (`../release-install.ts`). Short-term
 * consumers: 1Pact developer machines, whose adapter-astrale 0.5.0-beta.148 `ensureServices` execs
 * `domain install services.astrale.ai -i <instance>` (its argv, stdout and stderr stay unchanged);
 * operators installing a Fleet catalog Domain by its origin. Removal: see `./fleet-catalog.ts`.
 */
import chalk from 'chalk'

import type { KernelCommandOpts } from '../../../connection'
import type { AdminTargetCommandOpts } from '../../../lib/admin-target'

import { withAdminClientSession } from '../../../connection'
import { formatKernelError } from '../../../connection/errors'
import { AstraleError } from '../../../errors'
import {
  listOwnedInstancesInContext,
  resolveOwnedInstanceInContext,
  type OwnedInstanceInfo,
} from '../../../lib/admin-instance'
import { getActive } from '../../../lib/instance'
import { canPrompt } from '../../../lib/interactive'
import { fatal, log, withSpinner } from '../../../lib/log'
import { isMachine, output } from '../../../lib/output'
import { promptText, selectFrom } from '../../../lib/prompt'
import { warnFleetCatalogDeprecated } from './catalog-deprecation'
import {
  installAdminDomainInContext,
  listAdminDomainsInContext,
  type DomainInfo,
} from './fleet-catalog'

export type CatalogInstallOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    // Programmatic opt-out for callers that drive this command as a function.
    // The matching CLI flags are read from argv by `canPrompt` — Commander
    // keeps root options out of a subcommand's action arguments.
    ci?: boolean
    noPrompt?: boolean
  }

/**
 * Install a published domain through the admin control plane. The domain is
 * addressed by its catalog `origin` (the registry key); a deployment URL or a
 * version goes to the instance Kernel instead (`installByReference`). The target instance is the
 * active one or `-i <slug>` and must be admin-managed.
 *
 * `-i` here means the INSTALL TARGET, not the admin target — so it is stripped
 * before resolving the admin client (which would otherwise read `-i`/`--url` as
 * an admin-kernel override). The admin kernel is chosen via --admin/--admin-url
 * or config, exactly like `domain publish`.
 */
export async function installViaAdmin(
  target: string | undefined,
  opts: CatalogInstallOpts,
  dependencies: Partial<AdminInstallDependencies> = {},
): Promise<void> {
  warnFleetCatalogDeprecated('install', opts)
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
  opts: CatalogInstallOpts,
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
