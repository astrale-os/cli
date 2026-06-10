import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { withAdminKernelClient } from '../../kernel/client'
import { ADMIN_INSTANCE, type InstanceInfo } from '../../lib/admin-instance'
import { getActive, normalizeInstanceKernelUrl } from '../../lib/instance'
import { log } from '../../lib/log'
import { RAW_OUTPUT_OPTIONS, isMachine, output, type RawOutputOpts } from '../../lib/output'

export default {
  name: 'active',
  description: 'Show the currently active instance',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: RawOutputOpts) => {
    try {
      const isRaw = isMachine(opts)
      const active = await resolveActiveForDisplay()
      const { name } = active
      const url = active.url ?? null
      const createdAt = active.createdAt ?? null

      if (isRaw) {
        output({ name, url, createdAt }, opts)
        return
      }

      console.log(`${chalk.bold(name)} (${url ?? 'local'})`)
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
} satisfies CommandDefinition

async function resolveActiveForDisplay(): Promise<{
  name: string
  url?: string
  createdAt?: string
}> {
  const active = await getActive()
  if (active.url) {
    return {
      name: active.name,
      url: active.url,
      createdAt: active.createdAt,
    }
  }

  try {
    const managed = await withAdminKernelClient(
      {},
      async (ctx) =>
        (await ctx.client.call(`${ADMIN_INSTANCE}/info`, { id: active.name })) as InstanceInfo,
    )
    return {
      name: managed.slug,
      url: normalizeInstanceKernelUrl(managed.url),
      createdAt: managed.createdAt,
    }
  } catch {
    return { name: active.name }
  }
}
