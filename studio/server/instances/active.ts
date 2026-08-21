import type { InstanceInfo, InstancesState } from '../../shared/types'

import { decodeJsonObject, runStudioCliJson, runStudioCliText } from '../cli'

async function astraleJson(args: string[]): Promise<Record<string, unknown> | null> {
  const result = await runStudioCliJson(args, decodeJsonObject)
  return result.ok ? result.data : null
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(decodeJsonObject).filter((item) => item !== null) : []
}

async function activeName(): Promise<string | null> {
  const active = await astraleJson(['instance', 'active', '--json'])
  return typeof active?.name === 'string' ? active.name : null
}

/** The CLI-owned global active instance. */
export const activeInstanceName = activeName

export async function listInstances(): Promise<InstancesState> {
  const local = await astraleJson(['instance', 'list', '--bookmarked', '--json'])
  const active = typeof local?.active === 'string' ? local.active : await activeName()
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
  const managed = await astraleJson(['instance', 'list', '--admin-only', '--json'])
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
    active: await activeName(),
    output: (combined || result.detail).slice(-1000),
  }
}
