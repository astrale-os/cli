import chalk from 'chalk'

import type { OwnedInstanceInfo } from '../../lib/admin-instance'
import type { SetupContext, SetupStep } from '../types'

import { AstraleError } from '../../errors'
import { listOwnedInstancesWithIdentity } from '../../lib/admin-instance'
import { normalizeInstanceKernelUrl, setActive, upsertManagedBookmark } from '../../lib/instance'
import { readLocalStatus } from '../../lib/local-status'
import { log, withSpinner } from '../../lib/log'
import { renderInstanceHero } from '../../lib/panel'
import { confirmDefaultYes, promptText, selectFrom } from '../../lib/prompt'
import { provisionInstance, type ProvisionResult } from '../../lib/provision-instance'
import { guiOrigin, slugError } from '../util'

export type InstanceSetupDependencies = {
  fetchOwned: (ctx: SetupContext) => Promise<{
    readonly instances: OwnedInstanceInfo[]
    readonly identity?: string
  }>
  adopt: (info: OwnedInstanceInfo, identity?: string) => Promise<void>
  selectReady: (instances: OwnedInstanceInfo[]) => Promise<OwnedInstanceInfo | null>
  confirmCreate: () => Promise<boolean>
  promptSlug: () => Promise<string | undefined>
  provision: (slug: string) => Promise<ProvisionResult>
}

export type OwnedInstanceAdoptionDependencies = {
  upsert: typeof upsertManagedBookmark
  activate: (slug: string) => Promise<unknown>
}

/** Print the click-inviting hero for a freshly-active instance. */
function hero(slug: string, kernelUrl: string): void {
  console.log('')
  console.log(renderInstanceHero(slug, guiOrigin(kernelUrl)))
  console.log('')
}

export async function adoptOwnedInstance(
  info: OwnedInstanceInfo,
  defaultIdentity?: string,
  deps: OwnedInstanceAdoptionDependencies = {
    upsert: upsertManagedBookmark,
    activate: setActive,
  },
): Promise<void> {
  const { repointedFrom } = await deps.upsert({
    key: info.slug,
    slug: info.slug,
    url: info.url,
    ...(info.organizationId ? { organizationId: info.organizationId } : {}),
    ...(defaultIdentity ? { defaultIdentity } : {}),
  })
  await deps.activate(info.slug)
  if (repointedFrom) {
    log.warn(
      `Bookmark "${info.slug}" repointed: ${repointedFrom} → ${normalizeInstanceKernelUrl(info.url)}`,
    )
  }
  log.success(`Active instance: ${info.slug}`)
  hero(info.slug, info.url)
}

function defaultDependencies(ctx: SetupContext): InstanceSetupDependencies {
  return {
    fetchOwned: (setupCtx) =>
      withSpinner('Checking for existing instances', !setupCtx.machine, () =>
        listOwnedInstancesWithIdentity(setupCtx.opts),
      ),
    adopt: adoptOwnedInstance,
    selectReady: (instances) =>
      selectFrom(
        'No active instance. Pick one:',
        instances.map((info) => ({
          label: `${info.slug}  ${chalk.dim(guiOrigin(info.url))}`,
          value: info,
        })),
      ),
    confirmCreate: () => confirmDefaultYes('No instances yet. Provision your first one now?'),
    promptSlug: () =>
      ctx.slug
        ? Promise.resolve(ctx.slug)
        : promptText('Pick a slug for your instance', { validate: slugError }),
    provision: (slug) => provisionInstance(slug, ctx.opts),
  }
}

/**
 * Reconcile owner-scoped admin instances when no local active bookmark exists.
 * A failed ownership lookup is never treated as an empty account: setup stops
 * before creation so a transient auth/network failure cannot create a duplicate.
 */
export async function ensureOwnedInstance(
  ctx: SetupContext,
  deps: InstanceSetupDependencies = defaultDependencies(ctx),
): Promise<'fixed' | 'skipped'> {
  let inventory: Awaited<ReturnType<InstanceSetupDependencies['fetchOwned']>>
  try {
    inventory = await deps.fetchOwned(ctx)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new AstraleError(
      'INSTANCE_DISCOVERY_FAILED',
      `Could not check your Astrale instances: ${detail}`,
      'No instance was created. Check `astrale admin status`, then rerun `astrale setup`.',
    )
  }

  const owned = inventory.instances

  const ready = owned.filter((info) => info.state === 'ready')
  if (ready.length === 1) {
    await deps.adopt(ready[0]!, inventory.identity)
    return 'fixed'
  }

  if (ready.length > 1) {
    const choice = await deps.selectReady(ready)
    if (choice === null) {
      log.dim('  Skipped — no active instance set.')
      return 'skipped'
    }
    await deps.adopt(choice, inventory.identity)
    return 'fixed'
  }

  if (owned.length > 0) {
    reportNotReady(owned)
    return 'skipped'
  }

  if (!(await deps.confirmCreate())) {
    log.dim('  Skipped — create one later: astrale instance create <slug>')
    return 'skipped'
  }

  const slug = await deps.promptSlug()
  if (!slug) {
    log.dim('  Skipped — no slug given.')
    return 'skipped'
  }

  const { created, selectionError } = await deps.provision(slug)
  if (created.state !== 'ready') {
    reportNotReady([created])
    return 'skipped'
  }
  if (selectionError) {
    const detail = selectionError instanceof Error ? selectionError.message : String(selectionError)
    throw new AstraleError(
      'INSTANCE_SELECTION_FAILED',
      `Instance "${slug}" was provisioned, but the CLI could not select it: ${detail}`,
      `Fix local CLI storage, then run \`astrale instance use ${slug}\`.`,
    )
  }
  hero(slug, created.url)
  return 'fixed'
}

function reportNotReady(instances: OwnedInstanceInfo[]): void {
  log.warn(
    `${instances.length === 1 ? 'Your instance is' : 'Your instances are'} not ready; setup will not create another.`,
  )
  for (const info of instances) {
    const phase = info.phase && info.phase !== info.state ? ` (${info.phase})` : ''
    log.dim(`  ${info.slug}: ${info.state}${phase} · astrale instance status ${info.slug}`)
    if (info.error) log.dim(`    ${info.error}`)
  }
  if (instances.some((info) => info.state === 'failed')) {
    log.dim(
      '  Inspect the failure, then deliberately delete/recreate it with `astrale instance` commands.',
    )
  } else {
    log.dim('  Wait for provisioning to finish, then rerun `astrale setup`.')
  }
}

/**
 * Step 3 — an active instance, the heart of the flow. If the user already has
 * owned instances, adopt the sole ready one or ask among several; only a
 * confirmed empty owner list may fall through to first-instance provisioning.
 */
export const instanceStep: SetupStep = {
  id: 'instance',
  title: 'Active instance',
  group: 'connect',

  async detect(ctx: SetupContext) {
    const { instance } = await readLocalStatus()
    if (instance) {
      return { state: 'satisfied', summary: `${instance.active} (${guiOrigin(instance.url)})` }
    }
    return {
      state: 'gap',
      summary: 'No active instance',
      fixHint: ctx.slug ? `astrale instance create ${ctx.slug}` : 'astrale instance create <slug>',
    }
  },

  async ensure(ctx: SetupContext) {
    const { instance } = await readLocalStatus()
    if (instance) {
      log.success(`Active instance: ${instance.active} (${guiOrigin(instance.url)})`)
      return 'unchanged'
    }

    return ensureOwnedInstance(ctx)
  },
}
