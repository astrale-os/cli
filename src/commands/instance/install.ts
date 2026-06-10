import { K } from '@astrale-os/kernel-core'
import chalk from 'chalk'

import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { AstraleError } from '../../errors'
import { runKernelCommand } from '../../kernel'
import { fatal, log } from '../../lib/log'
import { output } from '../../lib/output'
import { confirmWithInput } from '../../lib/prompt'

type InstallResult = { domainId: string; origin: string }

export default {
  name: 'install',
  description: 'Install a domain on the target instance from its domain URL',
  afterHelpText: `
Behavior:
  Installs a domain by asking the running domain service for a signed install
  bundle. Local spec.json installation is no longer a public API; run or deploy
  the domain service and install its URL instead.

  When the domain's declared origin differs from the serving host (identity
  aliasing / override), the install requires explicit consent: an interactive
  DANGER prompt, or --allow-identity-override in scripts.

Examples:
  $ astrale instance install https://contract.astrale.ai -i staging --as alice
  $ astrale instance install http://localhost:8787 --token "$INSTALL_TOKEN"
  $ astrale instance install https://crm.workers.dev --allow-identity-override
`,
  arguments: [{ name: 'url', description: 'Domain service URL', required: true }],
  options: [
    {
      flags: '--token <token>',
      description: 'Optional bearer token for private domain install endpoints',
    },
    {
      flags: '--allow-identity-override',
      description: 'Consent to installing a domain whose origin differs from its serving host',
    },
  ],
  action: async (
    url: string,
    opts: KernelCommandOpts & { token?: string; allowIdentityOverride?: boolean },
  ) => {
    // The pre-install phase throws AstraleErrors (bad URL, rejected override);
    // render them as `✖ message + hint` instead of the bin's raw rethrow.
    let host = ''
    let consentedOrigin: string | undefined
    try {
      host = validateInstallUrl(url)
      consentedOrigin = await ensureIdentityOverrideConsent(
        url,
        host,
        opts.allowIdentityOverride ?? false,
      )
    } catch (e) {
      fatal(e)
    }

    await runKernelCommand<InstallResult>({
      opts,
      label: `Installing domain from ${url}`,
      fn: async (ctx) =>
        (await ctx.client.call(K.Root.installDomain.path.method.raw, {
          url,
          ...(opts.token ? { token: opts.token } : {}),
        })) as InstallResult,
      format: (result, fmtOpts, isRaw) => {
        if (isRaw) {
          output(result, fmtOpts)
          return
        }
        log.success(`Domain installed: ${result.origin}`)
        log.dim(`  domainId: ${result.domainId}`)
        // Belt-and-braces: the kernel-confirmed origin is authoritative. If it
        // aliases the host and the pre-install gate never consented to THAT
        // origin (lying or absent `/meta`), say so loudly after the fact.
        if (isIdentityOverride(result.origin, host) && result.origin !== consentedOrigin) {
          log.warn(
            `Installed origin "${result.origin}" differs from the serving host "${host}" ` +
              `and was not confirmed before install (the worker's /meta did not declare it). ` +
              `Every ${result.origin}/* call on this instance now routes to ${host}.`,
          )
        }
      },
    })
  },
} satisfies CommandDefinition

function validateInstallUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AstraleError(
      'INVALID_DOMAIN_URL',
      `Domain install source must be an http(s) URL, got "${value}".`,
      'Run or deploy the domain service, then install its base URL, for example: astrale instance install https://contract.astrale.ai',
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
 * The pre-install check reads the worker's self-reported `/meta.domainName`,
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
    const body = (await res.json()) as { domainName?: unknown }
    return typeof body.domainName === 'string' && body.domainName.length > 0
      ? body.domainName
      : undefined
  } catch {
    // Unreachable /meta is not fatal here: the caller warns and the install
    // itself will surface a dead worker with its own error.
    return undefined
  }
}
