import chalk from 'chalk'

import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program/index'

import { formatKernelError } from '../../connection/errors'
import { AstraleError } from '../../errors'
import { statusOwnedInstance, type InstanceInfo } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { resolveInstance } from '../../lib/instance'
import { log, withSpinner } from '../../lib/log'
import { isMachine, output, type RawOutputOpts } from '../../lib/output'
import { probeBookmark } from './use'

type StatusOpts = KernelCommandOpts &
  AdminTargetCommandOpts &
  RawOutputOpts & { bookmarked?: boolean }

interface BookmarkStatus {
  readonly slug: string
  readonly url: string
  readonly issuer: string
  readonly kind: 'bookmark'
  readonly state: 'ready'
}

export default {
  name: 'status',
  description: 'Show managed instance status or probe a bookmark',
  arguments: [{ name: 'id', description: 'Instance slug', required: true }],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    { flags: '--bookmarked', description: 'Probe a locally bookmarked kernel connection' },
  ],
  action: async (id: string, opts: StatusOpts) => {
    try {
      const result = await withSpinner(`Fetching instance ${id}`, !isMachine(opts), () =>
        resolveStatus(id, opts),
      )
      if (isMachine(opts)) {
        output(result, opts)
        return
      }
      console.log(`${chalk.bold(result.slug)} ${chalk.dim(result.url)}`)
      const phase = 'phase' in result ? result.phase : undefined
      log.dim(`  state: ${result.state}${phase ? ` (${phase})` : ''}`)
      if ('error' in result && result.error) log.dim(`  error: ${result.error}`)
      if ('organizationId' in result && result.organizationId)
        log.dim(`  organization: ${result.organizationId}`)
      if ('createdAt' in result && result.createdAt) log.dim(`  created: ${result.createdAt}`)
    } catch (e) {
      await formatKernelError(e, isMachine(opts), undefined, opts.debug)
      process.exit(1)
    }
  },
} satisfies CommandDefinition

export interface StatusDependencies {
  readonly statusOwnedInstance: typeof statusOwnedInstance
  readonly resolveInstance: typeof resolveInstance
  readonly probeBookmark: typeof probeBookmark
}

const defaultStatusDependencies: StatusDependencies = Object.freeze({
  statusOwnedInstance,
  resolveInstance,
  probeBookmark,
})

export async function resolveStatus(
  id: string,
  opts: StatusOpts,
  dependencies: StatusDependencies = defaultStatusDependencies,
): Promise<InstanceInfo | BookmarkStatus> {
  if (!opts.bookmarked) return dependencies.statusOwnedInstance(opts, id)
  if (opts.admin !== undefined || opts.adminUrl !== undefined || opts.domainIssuer !== undefined) {
    throw new AstraleError(
      'INVALID_FLAG',
      '--bookmarked cannot be combined with Admin target options.',
      'Remove --bookmarked to inspect managed lifecycle, or remove the Admin options to probe a local bookmark.',
    )
  }
  const bookmark = await dependencies.resolveInstance(id, undefined, { persist: false })
  await dependencies.probeBookmark(bookmark)
  return Object.freeze({
    slug: bookmark.name,
    url: bookmark.url,
    issuer: bookmark.issuer ?? bookmark.url,
    kind: 'bookmark',
    state: 'ready',
  })
}
