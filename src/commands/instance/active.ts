import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { listOwnedInstances } from '../../kernel/client'
import { findOwnedInstance } from '../../lib/admin-instance'
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
    const managed = findOwnedInstance(await listOwnedInstances({}), active.name)
    if (!managed) return { name: active.name }
    return {
      name: managed.slug,
      url: normalizeInstanceKernelUrl(managed.url),
      createdAt: managed.createdAt,
    }
  } catch {
    return { name: active.name }
  }
}
