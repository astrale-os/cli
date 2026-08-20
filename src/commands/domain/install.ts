import { Path } from '@astrale-os/sdk/graph/path'
import { syscalls } from '@astrale-os/sdk/schema/kernel'
import chalk from 'chalk'

import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program/index'

import { createPathCall, runKernelCommand, withAdminClientSession } from '../../connection'
import { AstraleError } from '../../errors'
import {
  installAdminDomainInContext,
  listAdminDomainsInContext,
  type DomainInfo,
} from '../../lib/admin-domain'
import { listOwnedInstancesInContext, type OwnedInstanceInfo } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { getActive } from '../../lib/instance'
import { fatal, log, withSpinner } from '../../lib/log'
import { isMachine, output } from '../../lib/output'
import { confirmWithInput, promptText, selectFrom } from '../../lib/prompt'
import { isHttpUrl } from '../../lib/validation'

/** Public Kernel install syscall input for one remote URL. */
export function directInstallCallInput(url: string, operation: string, token?: string) {
  return Object.freeze({
    operation,
    domains: [
      Object.freeze({
        source: Object.freeze({
          kind: 'remote' as const,
          url,
          ...(token === undefined ? {} : { token }),
        }),
      }),
    ],
  })
}

type DirectInstallResult = {
  readonly operation: string
  readonly transitions: readonly {
    readonly intent: {
      readonly origin: string
      readonly target?: { readonly schemaRevision?: string } | null
    }
  }[]
}

const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function acceptOperationId(input: unknown): string {
  if (typeof input !== 'string' || !OPERATION_ID_PATTERN.test(input)) {
    throw new AstraleError(
      'INVALID_FLAG',
      '--operation must be a canonical lowercase UUIDv4.',
      'Omit --operation for a fresh install; use it only with the exact UUID printed for recovery.',
    )
  }
  return input
}

function createOperationId(): string {
  return acceptOperationId(globalThis.crypto.randomUUID())
}

type InstallOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    direct?: boolean
    operation?: string
    token?: string
    allowIdentityOverride?: boolean
    // Global flags (program.ts) that force non-interactive.
    ci?: boolean
    noPrompt?: boolean
  }

export default {
  name: 'install',
  description: 'Install a domain on an instance (via the admin catalog, or --direct from a url)',
  afterHelpText: `
Behavior:
  Default: installs a PUBLISHED domain through the admin control plane
  (DomainEntry.install). Address it by its catalog \`origin\` (the unique
  registry key) or by its \`url\`; run it bare to pick from the catalog
  interactively. The target instance is the active one, or -i <slug>; it must be
  admin-managed (otherwise the command fails loudly and points you at --direct).

  --direct: installs a url through the public Kernel install syscall,
  bypassing the admin catalog. Works on any instance you can authenticate to
  (managed, bookmarked, or local), using your own authority. This is the only
  mode that runs the identity-override consent gate: when the domain's declared
  origin differs from its serving host, it requires explicit consent (an
  interactive DANGER prompt, or --allow-identity-override in scripts).

  A fresh, strong operation id is generated automatically. Use --operation
  only to retry or recover the exact same direct install after an outcome-unknown
  timeout or disconnect.

Examples:
  $ astrale domain install crm.acme.dev -i staging          # by origin, via admin
  $ astrale domain install https://crm.acme.dev             # by url, via admin
  $ astrale domain install                                   # interactive: pick domain + instance
  $ astrale domain install https://crm.workers.dev --direct # straight to the instance kernel
  $ astrale domain install http://localhost:8787 --direct --token "$INSTALL_TOKEN"
`,
  arguments: [
    {
      name: 'target',
      description: 'Domain origin or url (omit to pick from the catalog interactively)',
      required: false,
    },
  ],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    {
      flags: '--direct',
      description:
        'Install a url straight onto the instance kernel, bypassing the admin catalog (any instance; runs the identity-override gate)',
    },
    {
      flags: '--token <token>',
      description: 'Bearer token for private domain install endpoints (--direct only)',
    },
    {
      flags: '--operation <uuid>',
      description: 'Reuse an exact direct-install operation id for explicit retry/recovery',
    },
    {
      flags: '--allow-identity-override',
      description: 'Consent to a domain whose origin differs from its serving host (--direct only)',
    },
  ],
  action: async (target: string | undefined, opts: InstallOpts) => {
    if (opts.operation !== undefined && !opts.direct) {
      fatal(
        new AstraleError(
          'INVALID_FLAG',
          '--operation is valid only with --direct.',
          'Ordinary direct installs generate a fresh operation id automatically.',
        ),
        opts,
      )
    }
    if (opts.direct) {
      await installDirect(target, opts)
      return
    }
    await installViaAdmin(target, opts)
  },
} satisfies CommandDefinition

// ── Admin path (default) ──────────────────────────────────────────────────────

/**
 * Install a published domain through the admin control plane. The domain is
 * addressed by `origin` (catalog key) or `url`; the target instance is the
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
  const interactive = !!process.stdin.isTTY && !(opts.ci || opts.noPrompt || process.env.CI)
  if (!target && !interactive) {
    fatal(
      new AstraleError(
        'MISSING_ARG',
        'No domain given and no TTY for interactive selection.',
        'Pass an origin or url, e.g. astrale domain install crm.acme.dev — or use --direct <url>.',
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
      const instances = await admin.listInstances(ctx)
      const slug = await resolveTargetSlug(opts, target, interactive, instances)

      const match = instances.find((i) => i.slug === slug)
      if (!match) {
        const known = instances.map((i) => i.slug).join(', ') || '(none)'
        throw new AstraleError(
          'INSTANCE_NOT_MANAGED',
          `Instance "${slug}" is not admin-managed (managed: ${known}).`,
          `Install the url directly onto it instead: astrale domain install <url> --direct -i ${slug}`,
        )
      }
      assertInstallTargetReady(match)

      const domains = await admin.listDomains(ctx)
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
  } catch (e) {
    fatal(e, opts)
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

/**
 * Classify the positional install target for the admin path: an http(s) URL
 * installs by `url`, anything else is treated as a catalog `origin` (the unique
 * registry key). The admin method accepts either.
 */
export function domainRefFromTarget(target: string): { origin?: string; url?: string } {
  return isHttpUrl(target) ? { url: target } : { origin: target }
}

/** Resolve the domain to install: the positional `target`, or an interactive pick. */
async function resolveDomain(
  catalog: readonly DomainInfo[],
  target: string | undefined,
  interactive: boolean,
): Promise<DomainInfo> {
  if (target) {
    const ref = domainRefFromTarget(target)
    const found = catalog.find((domain) =>
      ref.origin === undefined ? domain.url === ref.url : domain.origin === ref.origin,
    )
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
  readonly listInstances: typeof listOwnedInstancesInContext
  readonly listDomains: typeof listAdminDomainsInContext
  readonly install: typeof installAdminDomainInContext
}

const defaultAdminInstallDependencies: AdminInstallDependencies = Object.freeze({
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

// ── Direct path (--direct) ────────────────────────────────────────────────────

/**
 * Install a url through the public Kernel install syscall,
 * bypassing the admin catalog, with the identity-override
 * consent gate. Works on any instance the caller can authenticate to.
 */
interface DirectInstallDependencies {
  readonly acceptOperationId: (input: unknown) => string
  readonly createOperationId: () => string
  readonly runKernelCommand: typeof runKernelCommand
}

const defaultDirectInstallDependencies: DirectInstallDependencies = Object.freeze({
  acceptOperationId,
  createOperationId,
  runKernelCommand,
})

export async function installDirect(
  target: string | undefined,
  opts: InstallOpts,
  dependencies: Partial<DirectInstallDependencies> = {},
): Promise<void> {
  const direct = { ...defaultDirectInstallDependencies, ...dependencies }
  let host = ''
  let consentedOrigin: string | undefined
  let operation: string
  try {
    if (!target) {
      throw new AstraleError(
        'MISSING_ARG',
        '--direct requires a domain url.',
        'e.g. astrale domain install https://crm.acme.dev --direct',
      )
    }
    host = validateInstallUrl(target)
    operation =
      opts.operation === undefined
        ? direct.createOperationId()
        : direct.acceptOperationId(opts.operation)
    consentedOrigin = await ensureIdentityOverrideConsent(
      target,
      host,
      opts.allowIdentityOverride ?? false,
    )
  } catch (e) {
    fatal(e, opts)
  }
  const url = target as string
  const retry = directInstallRetry(url, operation, opts)

  await direct.runKernelCommand<DirectInstallResult>({
    opts,
    label: `Installing domain from ${url} (operation ${operation})`,
    recovery: { operation, retry },
    fn: async ({ session }) =>
      (await session.call(
        createPathCall(
          Path.project(syscalls.install.ref).raw,
          directInstallCallInput(url, operation, opts.token),
        ),
      )) as DirectInstallResult,
    format: (result, fmtOpts, isRaw) => {
      if (isRaw) {
        output(result, fmtOpts)
        return
      }
      const installed = result.transitions[0]?.intent
      if (!installed) throw new Error('Kernel install returned no committed Domain transition.')
      const revision = installed.target?.schemaRevision ?? result.operation
      log.success(`Domain installed: ${installed.origin}@${revision}`)
      log.dim(`  operation:   ${result.operation}`)
      // Belt-and-braces: the kernel-confirmed origin is authoritative. If it
      // aliases the host and the pre-install gate never consented to THAT
      // origin (lying or absent `/meta`), say so loudly after the fact.
      if (isIdentityOverride(installed.origin, host) && installed.origin !== consentedOrigin) {
        log.warn(
          `Installed origin "${installed.origin}" differs from the serving host "${host}" ` +
            `and was not confirmed before install (the worker's /meta did not declare it). ` +
            `Every ${installed.origin}/* call on this instance now routes to ${host}.`,
        )
      }
    },
  })
}

function directInstallRetry(url: string, operation: string, opts: InstallOpts): string {
  const instance = opts.instance === undefined ? '' : ` -i ${opts.instance}`
  return `astrale domain install ${url} --direct --operation ${operation}${instance}`
}

function validateInstallUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AstraleError(
      'INVALID_DOMAIN_URL',
      `Domain install source must be an http(s) URL, got "${value}".`,
      'Run or deploy the domain service, then install its base URL, for example: astrale domain install https://contract.astrale.ai --direct',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AstraleError(
      'INVALID_DOMAIN_URL',
      `Domain install URL must use http or https, got "${url.protocol}".`,
    )
  }
  return url.hostname
}

/** An override = the declared origin and the serving host name differ. */
export function isIdentityOverride(origin: string, host: string): boolean {
  return origin.toLowerCase() !== host.toLowerCase()
}

/**
 * The §5 identity-override gate (spec: CREATE_ASTRALE_DOMAIN_DX). A domain's
 * `origin` is its addressing identity on the instance: every `<origin>/*` call
 * — including other domains' `requires` — routes to the installed URL.
 * Claiming an origin that differs from the serving host is an explicit actAs
 * and needs typed consent (or `--allow-identity-override` in scripts).
 *
 * The pre-install check reads the worker's self-reported `/meta.origin`,
 * so it is consent UX, not enforcement — a hostile worker can lie here, and
 * the kernel anchors the cryptographic identity (`iss`) on the real URL
 * regardless. When `/meta` is unreachable or silent on the origin, the gate
 * degrades to a warning and the kernel-confirmed origin is re-checked after
 * install (see `format` above).
 *
 * Returns the origin the user consented to (or `undefined` when no override
 * was detected / verifiable pre-install).
 */
async function ensureIdentityOverrideConsent(
  url: string,
  host: string,
  allow: boolean,
): Promise<string | undefined> {
  const origin = await probeDeclaredOrigin(url)
  if (origin === undefined) {
    log.warn(
      `Could not read a declared origin from ${new URL('/meta', url).href} — ` +
        `skipping the pre-install identity check (the installed origin is verified after install).`,
    )
    return undefined
  }
  if (!isIdentityOverride(origin, host)) return undefined

  if (allow) {
    log.warn(`Identity override consented via --allow-identity-override: ${origin} ← ${host}`)
    return origin
  }

  const banner =
    chalk.red.bold('⚠  DANGER — IDENTITY OVERRIDE') +
    '\n' +
    chalk.dim('│') +
    `  deployed   ${host}\n` +
    chalk.dim('│') +
    `  origin     ${chalk.bold(origin)}   ${chalk.red('(≠)')}\n` +
    chalk.dim('│') +
    '\n' +
    chalk.dim('│') +
    `  Every call to ${origin}/* on this instance —\n` +
    chalk.dim('│') +
    `  including from other domains — will hit ${host}.\n` +
    chalk.dim('│') +
    `  Only proceed if you trust ${host}.`
  const confirmed = await confirmWithInput(banner, origin)
  if (!confirmed) {
    throw new AstraleError(
      'IDENTITY_OVERRIDE_REJECTED',
      `Install aborted: the domain at ${host} declares origin "${origin}" (identity override) and it was not confirmed.`,
      'Re-run interactively and type the origin to confirm, or pass --allow-identity-override in scripts.',
    )
  }
  return origin
}

/** Best-effort read of the worker's declared origin from its `/meta` probe. */
export async function probeDeclaredOrigin(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(new URL('/meta', url), { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return undefined
    // SDK workers serve `origin`; `domainName` is the pre-Kernel-V2 name, kept
    // as a fallback for workers deployed before the rename.
    const body = (await res.json()) as { origin?: unknown; domainName?: unknown }
    const declared = body.origin ?? body.domainName
    return typeof declared === 'string' && declared.length > 0 ? declared : undefined
  } catch {
    // Unreachable /meta is not fatal here: the caller warns and the install
    // itself will surface a dead worker with its own error.
    return undefined
  }
}
