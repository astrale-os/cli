import type { SetupContext, SetupStep } from '../types'

import { AdminTargetConfigSchema, DEFAULT_ADMIN_TARGET_NAME } from '../../lib/admin-target'
import { readConfig, writeConfig } from '../../lib/config'
import { readLocalStatus } from '../../lib/local-status'
import { log } from '../../lib/log'
import { promptText } from '../../lib/prompt'
import { urlError } from '../util'

const FIX = 'astrale admin use --url <admin-url>'

async function setAdminUrl(url: string): Promise<void> {
  const config = await readConfig()
  await writeConfig({
    ...config,
    admin: AdminTargetConfigSchema.parse({ name: DEFAULT_ADMIN_TARGET_NAME, url, issuer: url }),
  })
}

async function setAdminBookmark(bookmark: string): Promise<void> {
  const config = await readConfig()
  await writeConfig({ ...config, admin: AdminTargetConfigSchema.parse({ instance: bookmark }) })
}

/**
 * Step 2 — the admin control plane. There's always a default (admin.eu), so the
 * checklist shows it as satisfied and setup just confirms it with a ✔ line — no
 * prompt, since the default is right for nearly everyone and asking only confused
 * first-run users. Explicit --admin-url / --admin flags still persist immediately,
 * and power users repoint later with `astrale admin use <bookmark>|--url <url>`.
 * The only prompt left is the recovery path when the configured target is broken.
 */
export const adminStep: SetupStep = {
  id: 'admin',
  title: 'Admin control plane',
  group: 'connect',

  async detect() {
    const { admin } = await readLocalStatus()
    if ('error' in admin) {
      return { state: 'broken', summary: `Admin target invalid: ${admin.error}`, fixHint: FIX }
    }
    return {
      state: 'satisfied',
      summary: `${admin.name} (${admin.url})`,
      detail: `source: ${admin.source}`,
    }
  },

  async ensure(ctx: SetupContext) {
    // Explicit overrides win and persist, no prompt.
    if (ctx.opts.adminUrl) {
      await setAdminUrl(ctx.opts.adminUrl)
      log.success(`Admin control plane set: ${ctx.opts.adminUrl}`)
      return 'fixed'
    }
    if (ctx.opts.admin) {
      await setAdminBookmark(ctx.opts.admin)
      log.success(`Admin control plane set: bookmark "${ctx.opts.admin}"`)
      return 'fixed'
    }

    const { admin } = await readLocalStatus()
    if ('error' in admin) {
      log.warn(`Admin target invalid: ${admin.error}`)
      const url = await promptText('Admin kernel URL', { validate: urlError })
      if (!url) return 'skipped'
      await setAdminUrl(url)
      log.success(`Admin control plane set: ${url}`)
      return 'fixed'
    }

    // Configured or baked default: accept it silently — no prompt. Power users
    // repoint with `astrale admin use` (or the --admin-url / --admin flags above).
    log.success(`Admin control plane: ${admin.name} (${admin.url})`)
    return 'unchanged'
  },
}
