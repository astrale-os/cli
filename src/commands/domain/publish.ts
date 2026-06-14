import chalk from 'chalk'

import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { withAdminKernelClient } from '../../kernel/client'
import { ADMIN_DOMAIN, type DomainInfo } from '../../lib/admin-domain'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { fatal, withSpinner } from '../../lib/log'
import { isMachine, output } from '../../lib/output'
import { promptText } from '../../lib/prompt'
import { isHttpUrl, validateName, validateUrl } from '../../lib/validation'

type PublishOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    origin?: string
    name?: string
    // `--public-url`, not `--url`: the global `--url` already means "target this
    // kernel" (KERNEL_PASSTHROUGH_OPTIONS). This is the domain's own public
    // address the kernel installs from — named for the role, not the substrate.
    publicUrl?: string
    description?: string
    installByDefault?: boolean
    // Global flags (program.ts) that force non-interactive — mirrors `instance use`.
    ci?: boolean
    noPrompt?: boolean
  }

/** Host of a URL (the natural `origin` default), or undefined if unparseable. */
function hostOf(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

export default {
  name: 'publish',
  description: 'Register a deployed domain in the admin catalog (DomainEntry.publish)',
  afterHelpText: `
Behavior:
  Upserts a catalog entry on the configured admin kernel: a domain's addressing
  \`origin\`, registry \`name\`, and published \`url\` (no bytes, no version — the
  author deploys the worker independently; publish just points the registry at
  it). Idempotent: re-publishing the same name updates its url.

  Publishing only makes the domain INSTALLABLE. Mount it on an instance with
  \`astrale domain install <url>\` (or rely on the admin's install-by-default
  policy). This is usually invoked for you by \`astrale-domain publish\` right
  after a deploy, so the freshly-deployed URL is what gets registered.

  Run in a terminal with flags omitted and it PROMPTS for origin / name /
  public-url (origin defaults to the URL host, name to the origin's first
  label). With no TTY — or \`--ci\` / \`--no-prompt\` — those three are required
  up front, so piped / CI / agent runs fail fast instead of waiting on input.

Examples:
  $ astrale domain publish --origin crm.acme.dev --name crm --public-url https://crm.acme.dev
`,
  options: [
    ...ADMIN_TARGET_OPTIONS,
    { flags: '--origin <origin>', description: 'Domain addressing origin (e.g. crm.acme.dev)' },
    { flags: '--name <name>', description: 'Registry name / catalog slug (e.g. crm)' },
    { flags: '--public-url <url>', description: 'Public URL the kernel installs the domain from' },
    { flags: '--description <text>', description: 'Optional human description for the catalog' },
    {
      flags: '--install-by-default',
      description: 'Mark the domain for install on every new instance (alphaCreate)',
    },
  ],
  // No positional arguments → Commander passes (opts, command); `opts` is first.
  action: async (opts: PublishOpts) => {
    try {
      // Interactive fill (TTY only): a human running this by hand is prompted for
      // any missing field. The primary caller — `astrale-domain publish` — always
      // passes every flag, so it never prompts. No TTY / --ci / --no-prompt / CI
      // env → no prompt: fall straight through to the required-flag error below,
      // so a piped / agent / LLM run fails fast instead of hanging on a read.
      const interactive = !!process.stdin.isTTY && !(opts.ci || opts.noPrompt || process.env.CI)
      let { origin, name, publicUrl } = opts
      if (interactive) {
        if (!publicUrl)
          publicUrl = await promptText('Public URL (https://…)', {
            validate: (v) => isHttpUrl(v) || 'Enter a valid http(s) URL',
          })
        if (!origin)
          origin = await promptText('Domain origin (e.g. crm.acme.dev)', {
            default: hostOf(publicUrl),
          })
        if (!name) name = await promptText('Registry name', { default: origin?.split('.')[0] })
      }

      if (!origin || !name || !publicUrl) {
        throw new Error(
          'domain publish requires --origin, --name and --public-url, e.g.\n' +
            '  astrale domain publish --origin crm.acme.dev --name crm --public-url https://crm.acme.dev',
        )
      }
      validateName(origin, 'origin')
      validateName(name, 'domain')
      validateUrl(publicUrl)

      const result = await withSpinner(
        `Publishing ${name} → ${publicUrl}`,
        !isMachine(opts),
        () =>
          withAdminKernelClient(
            opts,
            async (ctx) =>
              (await ctx.client.call(`${ADMIN_DOMAIN}/publish`, {
                origin,
                name,
                url: publicUrl,
                ...(opts.description ? { description: opts.description } : {}),
                ...(opts.installByDefault ? { installByDefault: true } : {}),
              })) as DomainInfo,
          ),
        {
          success: (entry) =>
            `Published: ${entry.name} ${chalk.dim(`(${entry.origin} → ${entry.url})`)}`,
        },
      )

      if (isMachine(opts)) {
        output(result, opts)
        return
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
