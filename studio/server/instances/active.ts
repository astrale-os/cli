import type { InstanceState } from '../../../src/admin/instance'
import type { InstanceInfo, InstancesState } from '../../shared/contracts/workspace'

import { studioActiveInstanceName } from '../../../src/commands/studio-views'
import { matchAdminInstance, ownershipReason } from '../../../src/lib/admin/ownership'
import { runStudioCliJson, runStudioCliText } from '../cli'
import { asJsonRecord, decodeEach, type JsonRecord } from '../json'

async function astraleJson(args: string[]): Promise<JsonRecord | undefined> {
  const result = await runStudioCliJson(args, asJsonRecord)
  return result.ok ? result.data : undefined
}

function records(value: unknown): JsonRecord[] {
  return decodeEach(value, asJsonRecord) ?? []
}

/** One Admin Instance as `instance list --admin-only --json` reports it, ownership included. */
interface AdminRecord {
  slug: string
  url: string
  issuer?: string
  state: InstanceState
  /** Absent from an output that did not decide it: never read as ownership. */
  owned?: boolean
}

function adminRecord(value: JsonRecord): AdminRecord | undefined {
  if (typeof value.slug !== 'string' || typeof value.state !== 'string') return undefined
  return {
    slug: value.slug,
    url: typeof value.url === 'string' ? value.url : '',
    ...(typeof value.issuer === 'string' ? { issuer: value.issuer } : {}),
    state: value.state as InstanceState,
    ...(typeof value.owned === 'boolean' ? { owned: value.owned } : {}),
  }
}

const UNKNOWN = 'Ownership unknown'

export async function listInstances(): Promise<InstancesState> {
  // Each of these spawns the CLI — an 85 MB executable — and the header asks for the
  // list on every load. Run them together instead of one after another: the header
  // was costing three sequential process starts, on six browser connections the
  // canvas also needs. The Admin listing also decides ownership, in the same process.
  const [local, managed] = await Promise.all([
    astraleJson(['instance', 'list', '--bookmarked', '--json']),
    astraleJson(['instance', 'list', '--admin-only', '--json']),
  ])
  const active = typeof local?.active === 'string' ? local.active : await studioActiveInstanceName()
  return instancesState(local, managed, active)
}

/**
 * Every instance the CLI knows, each flagged with whether its user owns it in Admin. A bookmark is
 * owned only through the Admin Instance serving the same Kernel; when Admin could not be read,
 * nothing is owned, and the entry says so.
 */
export function instancesState(
  local: JsonRecord | undefined,
  managed: JsonRecord | undefined,
  active: string | null,
): InstancesState {
  const admin =
    managed === undefined
      ? undefined
      : records(managed.instances).flatMap((item) => adminRecord(item) ?? [])
  const merged = new Set<AdminRecord>()
  const instances: InstanceInfo[] = []
  for (const bookmark of records(local?.bookmarks)) {
    if (typeof bookmark.name !== 'string') continue
    const url = typeof bookmark.url === 'string' ? bookmark.url : ''
    const issuer = typeof bookmark.issuer === 'string' ? bookmark.issuer : null
    const match = admin === undefined ? undefined : matchAdminInstance({ url, issuer }, admin)
    if (match !== undefined && match !== 'ambiguous') merged.add(match)
    instances.push({
      name: bookmark.name,
      url,
      active: bookmark.active === true || bookmark.name === active,
      kind: 'bookmark',
      ...ownership(admin, match),
    })
  }
  for (const item of admin ?? []) {
    if (merged.has(item) || instances.some((instance) => instance.name === item.slug)) continue
    instances.push({
      name: item.slug,
      url: item.url,
      active: item.slug === active,
      kind: 'managed',
      ...ownership(admin, item),
    })
  }
  if (active && !instances.some((instance) => instance.name === active)) {
    instances.unshift({
      name: active,
      url: '',
      active: true,
      kind: 'bookmark',
      owned: false,
      reason: UNKNOWN,
    })
  }
  return { active, instances }
}

function ownership(
  admin: readonly AdminRecord[] | undefined,
  match: AdminRecord | 'ambiguous' | undefined,
): Pick<InstanceInfo, 'owned' | 'reason'> {
  if (admin === undefined) return { owned: false, reason: `${UNKNOWN}: Admin unavailable` }
  if (match === undefined) return { owned: false, reason: ownershipReason('not-managed') }
  if (match === 'ambiguous') return { owned: false, reason: ownershipReason('ambiguous') }
  if (match.owned === undefined) return { owned: false, reason: UNKNOWN }
  return match.owned ? { owned: true } : { owned: false, reason: ownershipReason('not-owner') }
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
    active: await studioActiveInstanceName(),
    output: (combined || result.detail).slice(-1000),
  }
}
