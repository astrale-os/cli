import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { AstraleError } from '../../errors'
import { runKernelCommand } from '../../kernel'
import { log } from '../../lib/log'
import { output } from '../../lib/output'

type InstallResult = { domainId: string; origin: string }

export default {
  name: 'install',
  description: 'Install a domain on the target instance from its domain URL',
  afterHelpText: `
Behavior:
  Installs a domain by asking the running domain service for a signed install
  bundle. Local spec.json installation is no longer a public API; run or deploy
  the domain service and install its URL instead.

Examples:
  $ astrale instance install https://contract.astrale.ai -i staging --as alice
  $ astrale instance install http://localhost:8787 --token "$INSTALL_TOKEN"
`,
  arguments: [{ name: 'url', description: 'Domain service URL', required: true }],
  options: [
    {
      flags: '--token <token>',
      description: 'Optional bearer token for private domain install endpoints',
    },
  ],
  action: async (url: string, opts: KernelCommandOpts & { token?: string }) => {
    validateInstallUrl(url)

    await runKernelCommand<InstallResult>({
      opts,
      label: `Installing domain from ${url}`,
      fn: async (ctx) =>
        (await ctx.client.call('/kernel.astrale.ai/class.Root/installDomain', {
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
      },
    })
  },
} satisfies CommandDefinition

function validateInstallUrl(value: string): void {
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
}
