import type { InstanceInfo, InstancesState } from '../../shared/types'

import { studioActiveInstanceName } from '../../../src/lib/view/studio-runtime'
import { decodeJsonObject, runStudioCliJson, runStudioCliText } from '../cli'

async function astraleJson(args: string[]): Promise<Record<string, unknown> | null> {
  const result = await runStudioCliJson(args, decodeJsonObject)
  return result.ok ? result.data : null
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(decodeJsonObject).filter((item) => item !== null) : []
}

/** The CLI-owned global active instance. */
export const activeInstanceName = (): Promise<string | null> => studioActiveInstanceName()

interface ActiveInstanceDependencies {
  activeInstanceName: typeof activeInstanceName
}

export async function listInstances(): Promise<InstancesState> {
  // Each of these spawns the CLI — an 85 MB executable — and the header asks for the
  // list on every load. Run them together instead of one after another: the header
  // was costing three sequential process starts, on six browser connections the
  // canvas also needs.
  const [local, managed] = await Promise.all([
    astraleJson(['instance', 'list', '--bookmarked', '--json']),
    astraleJson(['instance', 'list', '--admin-only', '--json']),
  ])
  const active = typeof local?.active === 'string' ? local.active : await activeInstanceName()
  const instances: InstanceInfo[] = []
  for (const bookmark of records(local?.bookmarks)) {
    if (typeof bookmark.name !== 'string') continue
    instances.push({
      name: bookmark.name,
      url: typeof bookmark.url === 'string' ? bookmark.url : '',
      active: bookmark.active === true || bookmark.name === active,
      kind: 'bookmark',
    })
  }
  for (const item of records(managed?.instances)) {
    if (
      typeof item.slug !== 'string' ||
      instances.some((instance) => instance.name === item.slug)
    ) {
      continue
    }
    instances.push({
      name: item.slug,
      url: typeof item.url === 'string' ? item.url : '',
      active: item.slug === active,
      kind: 'managed',
    })
  }
  if (active && !instances.some((instance) => instance.name === active)) {
    instances.unshift({ name: active, url: '', active: true, kind: 'bookmark' })
  }
  return { active, instances }
}

export async function setActiveInstance(
  name: string,
  dependencies: Partial<ActiveInstanceDependencies> = {},
): Promise<{ ok: boolean; active: string | null; output: string }> {
  const result = await runStudioCliText([
    'instance',
    'use',
    name,
    '--adopt-default',
    '--skip-jwks-check',
  ])
  const combined = `${result.stdout}\n${result.stderr}`.trim()
  return {
    ok: result.ok,
    active: await (dependencies.activeInstanceName ?? activeInstanceName)(),
    output: (combined || result.detail).slice(-1000),
  }
}
