import chalk from 'chalk'

import type { SetupContext, SetupStep } from '../types'

import { withAdminKernelClient } from '../../kernel/client'
import { adminInstanceMethod, type InstanceInfo } from '../../lib/admin-instance'
import { normalizeInstanceKernelUrl, setActive, upsertManagedBookmark } from '../../lib/instance'
import { readLocalStatus } from '../../lib/local-status'
import { log, withSpinner } from '../../lib/log'
import { renderInstanceHero } from '../../lib/panel'
import { confirmDefaultYes, promptText, selectFrom } from '../../lib/prompt'
import { provisionInstance } from '../../lib/provision-instance'
import { guiOrigin, slugError } from '../util'

/** All admin-managed instances; degrades to [] when the admin kernel is unreachable. */
async function fetchManaged(ctx: SetupContext): Promise<InstanceInfo[]> {
  try {
    return await withSpinner('Checking for existing instances', !ctx.machine, () =>
      withAdminKernelClient(
        ctx.opts,
        async (client) =>
          (await client.client.call(adminInstanceMethod('list'), {})) as InstanceInfo[],
      ),
    )
  } catch {
    return []
  }
}

/** Print the click-inviting hero for a freshly-active instance. */
function hero(slug: string, kernelUrl: string): void {
  console.log('')
  console.log(renderInstanceHero(slug, guiOrigin(kernelUrl)))
  console.log('')
}

async function adopt(info: InstanceInfo): Promise<void> {
  const { repointedFrom } = await upsertManagedBookmark(info.slug, info.slug, info.url)
  await setActive(info.slug)
  if (repointedFrom) {
    log.warn(
      `Bookmark "${info.slug}" repointed: ${repointedFrom} → ${normalizeInstanceKernelUrl(info.url)}`,
    )
  }
  log.success(`Active instance: ${info.slug}`)
  hero(info.slug, info.url)
}

/**
 * Step 3 — an active instance, the heart of the flow. If the user already has
 * managed instances, offer to adopt one or create another; otherwise offer to
 * provision their first. Either way ends on the instance hero.
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

    const managed = await fetchManaged(ctx)

    // Pick an existing instance or fall through to creating a new one.
    if (managed.length > 0) {
      const choice = await selectFrom<InstanceInfo | 'create'>(
        'No active instance. Pick one or create a new instance:',
        [
          ...managed.map((info) => ({
            label: `${info.slug}  ${chalk.dim(guiOrigin(info.url))}`,
            value: info as InstanceInfo | 'create',
          })),
          { label: chalk.cyan('➕  Create a new instance'), value: 'create' as const },
        ],
      )
      if (choice === null) {
        log.dim('  Skipped — no active instance set.')
        return 'skipped'
      }
      if (choice !== 'create') {
        await adopt(choice)
        return 'fixed'
      }
    } else {
      const yes = await confirmDefaultYes('No instances yet. Provision your first one now?')
      if (!yes) {
        log.dim('  Skipped — create one later: astrale instance create <slug>')
        return 'skipped'
      }
    }

    const slug =
      ctx.slug ?? (await promptText('Pick a slug for your instance', { validate: slugError }))
    if (!slug) {
      log.dim('  Skipped — no slug given.')
      return 'skipped'
    }

    const { created } = await provisionInstance(slug, ctx.opts)
    hero(slug, created.url)
    return 'fixed'
  },
}
