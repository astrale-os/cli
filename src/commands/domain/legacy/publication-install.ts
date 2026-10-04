/**
 * Install by URL on a Kernel that does not list installed releases (introspection kind
 * `installed`), such as the 1Pact consumer Host on Kernel beta.117: the exact request and
 * diagnostics of `astrale domain install <url> --direct` before installs were grouped. Its
 * `publication` request keeps its v3 meaning on every Kernel, and only Kernels that predate the
 * `release` request reach this module.
 *
 * @deprecated Successor: the `release` request of `../release-install.ts`, sent to every Kernel
 * that lists installed releases. Short-term consumer: 1Pact developer machines, which run the
 * newest global CLI against the beta.117 Host: sdk 0.6.0-beta.0 `reconcile` execs
 * `domain install <url> --direct --allow-identity-override -i <instance>`. Removal (D13): once no
 * supported Kernel lacks the `installed` listing, in a breaking CLI release.
 */
import type { InstallRequest, InstallResult } from '@astrale-os/sdk/client/schema'

import type { KernelCommandOpts } from '../../../connection'
import type { ConnectionContext } from '../../../connection'
import type { InstallFailure } from '../install-call'

import { log } from '../../../lib/log'
import { isMachine, output } from '../../../lib/output'
import { ensureIdentityOverrideConsent, warnUnconfirmedOverride } from '../identity-override'
import { runInstallCall } from '../install-call'

/** One URL to install, as written, beside the host name that serves it. */
export interface PublicationSource {
  readonly url: string
  readonly host: string
}

type PublicationInstallOpts = KernelCommandOpts & {
  readonly instance?: string
  readonly token?: string
  readonly allowIdentityOverride?: boolean
}

/** The pre-release request: one `publication` source per URL, in the order written. */
export function publicationInstallInput(
  urls: readonly [string, ...string[]],
  operation: string,
  token?: string,
): InstallRequest {
  const domains = urls.map((url) =>
    Object.freeze({
      publication: Object.freeze({
        url,
        ...(token === undefined ? {} : { token }),
      }),
    }),
  )
  return Object.freeze({
    operation: operation as InstallRequest['operation'],
    domains: Object.freeze(domains) as unknown as InstallRequest['domains'],
  })
}

export interface PublicationInstallPresentation {
  readonly operation: string
  readonly origin: string
  readonly revision: string
  readonly status: 'installed' | 'already current'
}

/** Stable CLI presentation derived from the canonical binary install result, one entry per root. */
export function publicationInstallPresentation(
  result: InstallResult,
  requestedOperation: string,
): readonly PublicationInstallPresentation[] {
  if (result.changed) {
    const transitions = result.receipt.transitions
    if (transitions.length === 0) {
      throw new Error('Kernel install returned no committed Domain transition.')
    }
    return transitions.map(({ intent }) => {
      if (!intent.generation) {
        throw new Error(
          'Kernel install returned a committed transition without a Domain generation.',
        )
      }
      return Object.freeze({
        operation: result.receipt.operation,
        origin: intent.origin,
        revision: intent.generation.revision,
        status: 'installed' as const,
      })
    })
  }
  return result.domains.map((installed) =>
    Object.freeze({
      operation: requestedOperation,
      origin: installed.origin,
      revision: installed.revision,
      status: 'already current' as const,
    }),
  )
}

/** The retry command printed when the outcome of the install is unknown. */
export function publicationInstallRetry(
  urls: readonly [string, ...string[]],
  operation: string,
  opts: PublicationInstallOpts,
): string {
  const instance = opts.instance === undefined ? '' : ` -i ${opts.instance}`
  return `astrale domain install ${urls.join(' ')} --direct --operation ${operation}${instance}`
}

/**
 * Run the pre-release install in an open session: the identity-override gate for each URL, then
 * one `schema.install` of every URL.
 */
export async function installPublications(
  context: ConnectionContext,
  sources: readonly [PublicationSource, ...PublicationSource[]],
  operation: string,
  opts: PublicationInstallOpts,
): Promise<InstallFailure | undefined> {
  const machine = isMachine(opts)
  const consented: (string | undefined)[] = []
  try {
    for (const source of sources) {
      consented.push(
        await ensureIdentityOverrideConsent(
          source.url,
          source.host,
          opts.allowIdentityOverride ?? false,
          machine,
        ),
      )
    }
  } catch (error) {
    return { error, render: 'input' }
  }
  const urls = sources.map((source) => source.url) as [string, ...string[]]
  const label =
    urls.length === 1
      ? `Installing domain from ${urls[0]} (operation ${operation})`
      : `Installing domains from ${urls.join(', ')} (operation ${operation})`
  return runInstallCall<InstallResult>(opts, {
    label,
    recovery: { operation, retry: publicationInstallRetry(urls, operation, opts) },
    call: () =>
      context.session.schema.install(publicationInstallInput(urls, operation, opts.token)),
    format: (result, raw) => {
      if (raw) {
        output(result, opts)
        return
      }
      const roots = publicationInstallPresentation(result, operation)
      const first = roots[0]
      if (first === undefined) throw new Error('Kernel install returned no installed Domain.')
      // One URL prints its first transition only, as before installs were grouped.
      for (const installed of sources.length === 1 ? [first] : roots) {
        log.success(`Domain ${installed.status}: ${installed.origin}@${installed.revision}`)
      }
      log.dim(`  operation:   ${first.operation}`)
      // Belt-and-braces: the kernel-confirmed origin is authoritative. If it aliases the host and
      // the pre-install gate never consented to THAT origin (lying or unavailable Publication),
      // say so loudly after the fact.
      if (sources.length === 1) {
        warnUnconfirmedOverride(first.origin, sources[0].host, consented[0], machine)
      }
    },
  })
}
