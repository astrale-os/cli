import type { SetupContext, SetupStep } from '../types'

import { AdminTargetConfigSchema, DEFAULT_ADMIN_TARGET_NAME } from '../../lib/admin-target'
import { readConfig, writeConfig } from '../../lib/config'
import { readLocalStatus } from '../../lib/local-status'
import { log } from '../../lib/log'
import { confirmDefaultYes, promptText } from '../../lib/prompt'
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
 * checklist shows it as satisfied; the hand-held path confirms the default on a
 * fresh setup and lets the user point elsewhere. Explicit --admin-url / --admin
 * flags persist immediately.
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

    // Unconfigured (the baked default): confirm it, or let them change it.
    if (admin.source === 'default') {
      const keepDefault = await confirmDefaultYes(
        `Use the default admin control plane (${admin.url})?`,
      )
      if (!keepDefault) {
        const url = await promptText('Admin kernel URL', { validate: urlError })
        if (url) {
          await setAdminUrl(url)
          log.success(`Admin control plane set: ${url}`)
          return 'fixed'
        }
        log.dim('  No URL entered — keeping the default.')
      }
    }

    log.success(`Admin control plane: ${admin.name} (${admin.url})`)
    return 'unchanged'
  },
}
