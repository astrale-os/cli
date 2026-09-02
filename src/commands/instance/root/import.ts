import chalk from 'chalk'

import type { KernelCommandOpts } from '../../../connection'
import type { AdminTargetCommandOpts } from '../../../lib/admin-target'
import type { CommandDefinition } from '../../../program'

import { formatKernelError } from '../../../connection/errors'
import { AstraleError } from '../../../errors'
import { findOwnedInstance, listOwnedInstancesWithIdentity } from '../../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS } from '../../../lib/admin-target'
import { importInstanceRootIdentity } from '../../../lib/instance-root-identity'
import { canPrompt } from '../../../lib/interactive'
import { log, withSpinner } from '../../../lib/log'
import { isMachine, output } from '../../../lib/output'
import { dangerPanel } from '../../../lib/panel'
import { confirmWithInput } from '../../../lib/prompt'

type ImportRootOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    readonly yes?: boolean
    readonly ci?: boolean
    readonly noPrompt?: boolean
  }

export default {
  name: 'import',
  description: 'Retrieve and import an owned Instance root identity',
  arguments: [{ name: 'instance', description: 'Owned Instance slug or id', required: true }],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    { flags: '--yes', description: 'Skip the typed recovery confirmation' },
  ],
  afterHelpText: `
Behavior:
  Retrieves the exact root signing identity from an owned Admin Instance over
  an end-to-end encrypted, one-use transfer. It is installed locally as
  <slug>-root. An existing local identity with that name is replaced; an
  IdP-backed identity is never overwritten. The Instance bookmark keeps the
  human Admin identity as its default and is not made active.

Examples:
  $ astrale instance root import demo
  $ astrale instance root import demo --yes
`,
  action: async (identifier: string, opts: ImportRootOpts) => {
    try {
      const inventory = await listOwnedInstancesWithIdentity(opts)
      const instance = findOwnedInstance(inventory.instances, identifier)
      if (instance === undefined) {
        throw new AstraleError(
          'INSTANCE_NOT_FOUND',
          `No owned Admin Instance matches ${JSON.stringify(identifier)}.`,
          'Run `astrale instance list` to see your instances.',
        )
      }
      await confirmRecovery(instance.slug, opts)

      const imported = await withSpinner(
        `Retrieving root identity for ${instance.slug}`,
        !isMachine(opts),
        () => importInstanceRootIdentity(opts, instance.id),
      )
      const result = Object.freeze({
        instance: imported.instance.id,
        slug: imported.instance.slug,
        identity: imported.name,
        subject: imported.identity.subject,
        issuer: imported.identity.issuer,
        replaced: imported.replaced,
        verification: imported.verification,
        bookmarked: imported.bookmarkError === undefined,
      })
      if (imported.bookmarkError !== undefined) {
        const message =
          imported.bookmarkError instanceof Error
            ? imported.bookmarkError.message
            : String(imported.bookmarkError)
        log.warn(`Root identity imported, but the Instance bookmark was not updated: ${message}`)
      }
      if (isMachine(opts)) {
        output(result, opts)
        return
      }
      log.success(`Imported Instance root identity: ${imported.name}`)
      log.dim(`  subject: ${imported.identity.subject}`)
      log.dim(`  issuer: ${imported.identity.issuer}`)
      log.dim(
        `  verification: ${imported.verification === 'live-jwks' ? 'live JWKS' : 'Host-sealed material'}`,
      )
    } catch (error) {
      await formatKernelError(error, isMachine(opts), undefined, opts.debug)
      process.exit(1)
    }
  },
} satisfies CommandDefinition

async function confirmRecovery(slug: string, opts: ImportRootOpts): Promise<void> {
  if (opts.yes) return
  if (!canPrompt(opts)) {
    throw new AstraleError(
      'CONFIRMATION_REQUIRED',
      `Importing the root identity for Instance "${slug}" requires explicit confirmation.`,
      `Re-run with --yes: astrale instance root import ${slug} --yes`,
    )
  }
  const warning = dangerPanel('ROOT IDENTITY RECOVERY', [
    `instance   ${chalk.bold(slug)}`,
    `identity   ${chalk.bold(`${slug}-root`)}`,
    '',
    'This retrieves the Instance root private signing key.',
    'An existing local key-backed identity with this name will be replaced.',
    'IdP-backed identities are protected and cannot be replaced.',
  ])
  if (!(await confirmWithInput(warning, slug, opts))) {
    throw new AstraleError(
      'ROOT_IDENTITY_IMPORT_CANCELLED',
      `Root identity import cancelled for Instance "${slug}".`,
    )
  }
}
