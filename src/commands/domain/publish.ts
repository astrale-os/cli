import chalk from 'chalk'

import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program/index'

import { formatKernelError } from '../../connection/errors'
import { AstraleError } from '../../errors'
import { publishAdminDomain } from '../../lib/admin-domain'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { domainPublicationUrl } from '../../lib/domain-publication'
import { canPrompt } from '../../lib/interactive'
import { withSpinner } from '../../lib/log'
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
    // Programmatic opt-out for callers that drive this command as a function.
    // The matching CLI flags are read from argv by `canPrompt` — Commander
    // keeps root options out of a subcommand's action arguments.
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
  it). Idempotent: re-publishing the same name updates its url — and a publish
  that would change nothing is reported as "already up to date" (no write).

  Publishing only makes the domain INSTALLABLE. Mount it on an instance with
  \`astrale domain install <url>\` (or rely on the admin's install-by-default
  policy). Deployment and catalog publication are separate owners: run the
  project's \`astrale-domain deploy <environment>\`, then publish its observed
  public URL with this command.

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
      description: 'Mark the domain for install on every new instance',
    },
  ],
  // No positional arguments → Commander passes (opts, command); `opts` is first.
  action: async (opts: PublishOpts) => {
    try {
      // Interactive fill (TTY only): a human running this by hand is prompted for
      // any missing field. Automation passes every flag. No TTY / --ci /
      // --no-prompt / CI env means no prompt: fall straight through to the
      // required-flag error below so a piped or agent run fails fast.
      let { origin, name, publicUrl } = opts
      if (canPrompt(opts)) {
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
        // AstraleError, not Error: this is the landing point of every
        // non-interactive run, and only a coded error keeps its message —
        // a plain one renders as "unexpected internal failure".
        throw new AstraleError(
          'MISSING_ARG',
          'domain publish requires --origin, --name and --public-url.',
          'astrale domain publish --origin crm.acme.dev --name crm --public-url https://crm.acme.dev',
        )
      }
      validateName(origin, 'origin')
      validateName(name, 'domain')
      validateUrl(publicUrl)
      const discoveryUrl = domainPublicationUrl(publicUrl).href

      const result = await withSpinner(
        `Publishing ${name} → ${publicUrl}`,
        !isMachine(opts),
        () =>
          publishAdminDomain(opts, {
            origin,
            name,
            url: discoveryUrl,
            ...(opts.description ? { description: opts.description } : {}),
            ...(opts.installByDefault ? { installByDefault: true } : {}),
          }),
        {
          success: ({ entry, changed, isNew }) =>
            changed
              ? `${isNew ? 'Published' : 'Updated'}: ${entry.name} ${chalk.dim(`(${entry.origin} → ${entry.url})`)}`
              : `Already up to date: ${entry.name} ${chalk.dim(`(${entry.origin} → ${entry.url} — no change, already latest)`)}`,
        },
      )

      if (isMachine(opts)) {
        output({ ...result.entry, changed: result.changed }, opts)
        return
      }
    } catch (e) {
      await formatKernelError(e, isMachine(opts), undefined, opts.debug)
      process.exit(1)
    }
  },
} satisfies CommandDefinition
