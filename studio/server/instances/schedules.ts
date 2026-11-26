import type {
  InstanceSchedule,
  InstanceSchedules,
  ScheduleAction,
  ScheduleActionResult,
  ScheduleRunResult,
  ScheduleStatus,
} from '../../shared/contracts/workspace'

import {
  memberCallable,
  membersQuery,
  scheduleMethodPath,
  schedulesQuery,
} from '../../../src/commands/studio-schedules'
import { mapBounded } from '../../../src/lib/concurrency'
import { runStudioCliJson } from '../cli'
import { asFiniteNumber, asJsonRecord, asString, decodeEach } from '../json'

/**
 * The Schedules of one installed Domain (ADR-10), read through the CLI as the active identity: a
 * Query from the Domain over its members' `schedule_of` Edges, the member each Function is in the
 * Domain, then `Schedule.status` of each. Root and holders of `schedule.reader` read Schedules;
 * anyone else gets an empty or refused listing. Pause, resume and run now are ordinary calls.
 */

const KERNEL = 'kernel.astrale.ai'
const SCHEDULE_INPUT = `${KERNEL}:class.Schedule.property.input`
const SCHEDULE_NAME = `${KERNEL}:class.Schedule.property.name`
const MEMBER = `${KERNEL}:class.of_domain.property.member`
/** A Domain declares at most 32 triggers on a Host; runtime Schedules add to them. */
const MAXIMUM_PAGES = 4
/** Each status read spawns the CLI: a few at a time. */
const STATUS_READS_AT_ONCE = 4

interface ScheduleNode {
  readonly id: string
  readonly name: string
  readonly function: string
  readonly input: unknown
}

/** The Schedules one page of `schedulesQuery` lists, and the cursor of the next page. */
export function decodeSchedulePage(
  value: unknown,
): { readonly schedules: ScheduleNode[]; readonly next?: string } | undefined {
  const page = asJsonRecord(value)
  if (page?.kind !== 'edges') return undefined
  const schedules = decodeEach(page.edges, (item): ScheduleNode | undefined => {
    const edge = asJsonRecord(item)
    const source = asJsonRecord(asJsonRecord(edge?.source)?.value)
    const target = asJsonRecord(asJsonRecord(edge?.target)?.value)
    const props = asJsonRecord(source?.props)
    const id = asString(source?.id)
    const name = asString(props?.[SCHEDULE_NAME])
    const function_ = asString(target?.id)
    if (id === undefined || name === undefined || function_ === undefined) return undefined
    return { id, name, function: function_, input: props?.[SCHEDULE_INPUT] ?? {} }
  })
  if (schedules === undefined) return undefined
  const next = asString(asJsonRecord(page.page)?.next)
  return { schedules, ...(next === undefined ? {} : { next }) }
}

/** Each Function's member name in its Domain (`function.digest`, `class.Ledger.method.sweep`). */
export function decodeMembers(value: unknown): Map<string, string> | undefined {
  const page = asJsonRecord(value)
  if (page?.kind !== 'edges') return undefined
  const entries = decodeEach(page.edges, (item) => {
    const edge = asJsonRecord(item)
    const props = asJsonRecord(asJsonRecord(asJsonRecord(edge?.edge)?.value)?.props)
    const member = asString(props?.[MEMBER])
    const id = asString(asJsonRecord(asJsonRecord(edge?.source)?.value)?.id)
    return member === undefined || id === undefined ? undefined : ([id, member] as const)
  })
  return entries === undefined ? undefined : new Map(entries)
}

const STATES = new Set(['active', 'paused', 'blocked'])

/** What `Schedule.status`, `pause` and `resume` answer, as Studio shows it. */
export function decodeScheduleStatus(value: unknown): ScheduleStatus | undefined {
  const status = asJsonRecord(value)
  const cron = asString(status?.cron)
  const timezone = asString(status?.timezone)
  const state = asString(status?.state)
  if (status === undefined || cron === undefined || timezone === undefined) return undefined
  if (state === undefined || !STATES.has(state)) return undefined
  const optional = (key: string) => {
    const text = asString(status[key])
    return text === undefined ? {} : { [key]: text }
  }
  const maxDelay = asFiniteNumber(status.maxDelay)
  return {
    declared: status.declared === true,
    cron,
    timezone,
    overlap: status.overlap === 'allow' ? 'allow' : 'skip',
    ...(maxDelay === undefined ? {} : { maxDelay }),
    state: state as ScheduleStatus['state'],
    ...optional('blocked'),
    ...optional('next'),
    ...optional('cursor'),
    ...optional('pausedAt'),
    ...optional('lastExecution'),
    missed: asFiniteNumber(status.missed) ?? 0,
    skipped: asFiniteNumber(status.skipped) ?? 0,
    refused: asFiniteNumber(status.refused) ?? 0,
  }
}

/** The Schedules of `origin` on instance `name`, each with its status. */
export async function listInstanceSchedules(
  name: string,
  origin: string,
): Promise<InstanceSchedules> {
  const nodes: ScheduleNode[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAXIMUM_PAGES; page += 1) {
    const result = await runStudioCliJson(
      [
        'query',
        '--ast',
        JSON.stringify(schedulesQuery(origin)),
        '--instance',
        name,
        ...(cursor === undefined ? [] : ['--cursor', cursor]),
      ],
      decodeSchedulePage,
    )
    if (!result.ok || !result.data) {
      return { ok: false, schedules: [], error: result.detail || 'Could not read the Schedules' }
    }
    nodes.push(...result.data.schedules)
    cursor = result.data.next
    if (cursor === undefined) break
  }
  if (nodes.length === 0) return { ok: true, schedules: [] }

  const functions = [...new Set(nodes.map((node) => node.function))]
  const [members, statuses] = await Promise.all([
    runStudioCliJson(
      ['query', '--ast', JSON.stringify(membersQuery(functions)), '--instance', name],
      decodeMembers,
    ),
    mapBounded(nodes, STATUS_READS_AT_ONCE, (node) =>
      runStudioCliJson(
        ['call', scheduleMethodPath(node.id, 'status'), '--instance', name],
        decodeScheduleStatus,
      ),
    ),
  ])
  const schedules = nodes.map((node, index): InstanceSchedule => {
    const member = members.data?.get(node.function)
    const target = member === undefined ? undefined : memberCallable(origin, member)
    const status = statuses[index]!
    return {
      id: node.id,
      name: node.name,
      callable: target?.callable ?? node.function,
      ...(target === undefined ? {} : { call: target.call }),
      input: node.input,
      ...(status.ok && status.data
        ? { status: status.data }
        : { error: status.detail || 'Could not read its status' }),
    }
  })
  schedules.sort(
    (left, right) =>
      left.callable.localeCompare(right.callable) || left.name.localeCompare(right.name),
  )
  return { ok: true, schedules }
}

/** Pause or resume one Schedule; the Kernel answers its status after the change. */
export async function actOnSchedule(
  name: string,
  schedule: string,
  action: ScheduleAction,
): Promise<ScheduleActionResult> {
  const result = await runStudioCliJson(
    ['call', scheduleMethodPath(schedule, action), '--instance', name],
    decodeScheduleStatus,
  )
  if (result.ok && result.data) return { ok: true, status: result.data }
  return { ok: false, error: result.detail || `Could not ${action} the Schedule` }
}

/**
 * Run a Schedule's callable now: an ordinary durable call of it with the Schedule's input, which
 * its Policy admits as the active identity's call. It is no tick: the handler sees no trigger.
 */
export async function runScheduleNow(
  name: string,
  call: string,
  input: unknown,
): Promise<ScheduleRunResult> {
  const result = await runStudioCliJson(
    ['call', call, '--data', JSON.stringify(input ?? {}), '--instance', name],
    (value) => {
      const receipt = asJsonRecord(value)
      return receipt?.kind === 'astrale.execution' ? asString(receipt.id) : undefined
    },
  )
  if (result.ok && result.data) return { ok: true, execution: result.data }
  return { ok: false, error: result.detail || 'Could not start the run' }
}
