/**
 * View Studio state and runtime bridge.
 *
 * Discovery and launches deliberately go through the public `astrale view`
 * and `astrale query` commands. The Studio therefore shares the CLI's real
 * View:resolve, identity, instance, delegation, proxy, and shell-handshake
 * behavior instead of maintaining a second preview implementation.
 */
import type {
  RememberedViewTarget,
  StudioSchemaBundle,
  ViewInfo,
  ViewRuntime,
  ViewSessionResult,
  ViewTargetCandidate,
  ViewTargetResult,
} from '../../shared/types'

import { ensureViewDevServer } from '../view-dev-server'
import { activeInstanceName } from './instance'
import { readJson, writeJson } from './store'

const STATE_FILE = 'views.json'
const TARGET_LIMIT = 200
const NAMED_NAME = 'kernel.astrale.ai:interface.Named.property.name'
const DESCRIPTABLE_DESCRIPTION = 'kernel.astrale.ai:interface.Descriptable.property.description'
const STATUSED_STATUS = 'kernel.astrale.ai:interface.Statused.property.status'
const DOMAIN_ORIGIN = 'kernel.astrale.ai:class.Domain.property.domain'

interface StoredViewState {
  targets?: Record<string, Record<string, RememberedViewTarget>>
}

interface AstraleResult<T> {
  ok: boolean
  data: T | null
  detail: string
}

interface RawTargetRow {
  id?: unknown
  props?: Record<string, unknown>
}

// A modal cleanup and the next modal launch can arrive almost simultaneously.
// The CLI view host owns a small local port range, so serialize its lifecycle
// commands and make the close complete before the next open allocates a port.
let viewSessionCommandTail: Promise<void> = Promise.resolve()

export function localViewUrl(serverUrl: string, mount: string): string {
  return new URL(mount.replace(/^\//, ''), `${new URL(serverUrl).origin}/`).toString()
}

export async function getViewRuntime(
  root: string,
  origin: string,
  view: ViewInfo,
  bundle: StudioSchemaBundle | null,
  timeoutMs: number,
): Promise<ViewRuntime> {
  const instance = await activeInstanceName()
  const serverPromise = !instance
    ? Promise.resolve({
        status: 'unavailable' as const,
        reason: 'Choose an Astrale instance before opening a local view.',
      })
    : view.mount
      ? ensureViewDevServer(root)
      : Promise.resolve({
          status: 'unavailable' as const,
          reason: 'This view has no local SPA mount.',
        })

  const targetRequired = viewClasses(view).length > 0
  const targetsPromise = targetRequired
    ? instance
      ? listViewTargets(root, origin, view, bundle, instance, timeoutMs)
      : Promise.resolve<ViewTargetResult>({
          status: 'unavailable',
          items: [],
          selected: null,
          stale: null,
          truncated: false,
          reason: 'No active Astrale instance.',
        })
    : Promise.resolve<ViewTargetResult>({
        status: 'available',
        items: [],
        selected: null,
        stale: null,
        truncated: false,
      })

  const [server, targets] = await Promise.all([serverPromise, targetsPromise])

  return {
    slug: view.slug,
    instance,
    targetRequired,
    server,
    targets,
  }
}

export async function launchViewSession(
  root: string,
  origin: string,
  view: ViewInfo,
  bundle: StudioSchemaBundle | null,
  request: { targetId?: unknown },
  timeoutMs: number,
): Promise<ViewSessionResult> {
  const instance = await activeInstanceName()
  if (!instance) return { status: 'unavailable', reason: 'No active Astrale instance.' }
  if (!view.mount) {
    return { status: 'unavailable', reason: 'This view has no local SPA mount.' }
  }

  let target: ViewTargetCandidate | null = null
  if (viewClasses(view).length > 0) {
    const targetId = typeof request.targetId === 'string' ? request.targetId.trim() : ''
    if (!targetId) return { status: 'unavailable', reason: 'Select a target before opening.' }
    const targets = await listViewTargets(root, origin, view, bundle, instance, timeoutMs)
    if (targets.status !== 'available') {
      return { status: 'unavailable', reason: targets.reason ?? 'Targets could not be queried.' }
    }
    target = targets.items.find((item) => item.id === targetId) ?? null
    if (!target) {
      return {
        status: 'unavailable',
        reason: 'That target no longer exists or is no longer visible. Choose another target.',
      }
    }
  }

  const server = await ensureViewDevServer(root)
  if (server.status !== 'running') {
    return {
      status: 'unavailable',
      reason: server.reason,
    }
  }

  const args = ['view', '--view-url', localViewUrl(server.url, view.mount), '--handshake', 'shell']

  if (target) {
    const targetPath = await resolveTargetPath(target.id, instance, timeoutMs)
    if (!targetPath) {
      return {
        status: 'unavailable',
        reason: 'That target no longer exists or is no longer visible. Choose another target.',
      }
    }
    args.push('--target', targetPath)
  }

  args.push('--no-open', '--json', '-i', instance)
  const opened = await runViewSessionCommand<{
    session?: { id?: string; pageUrl?: string; view?: { url?: string } }
  }>(args, Math.max(20_000, timeoutMs + 12_000))
  const session = opened.data?.session
  if (!opened.ok || !session?.id || !session.pageUrl || !session.view?.url) {
    return {
      status: 'unavailable',
      reason: opened.detail || '`astrale view` could not start the preview session.',
    }
  }

  if (target) rememberTarget(root, instance, view.slug, target)
  return {
    status: 'ready',
    sessionId: session.id,
    pageUrl: session.pageUrl,
    viewUrl: session.view.url,
    target,
  }
}

export async function closeViewSession(sessionId: string): Promise<{ ok: true }> {
  if (!/^v-[0-9a-f]+$/.test(sessionId)) return { ok: true }
  await runViewSessionCommand(['view', '--close', sessionId, '--json'], 6000)
  return { ok: true }
}

async function resolveTargetPath(
  id: string,
  instance: string,
  timeoutMs: number,
): Promise<string | null> {
  const result = await runAstraleJson<{ path?: unknown }>(
    ['get', `@${id}`, '--json', '-i', instance],
    timeoutMs,
  )
  return result.ok && typeof result.data?.path === 'string' ? result.data.path : null
}

async function listViewTargets(
  root: string,
  origin: string,
  view: ViewInfo,
  bundle: StudioSchemaBundle | null,
  instance: string,
  timeoutMs: number,
): Promise<ViewTargetResult> {
  const bindings = viewClasses(view).map((className) => ({
    className,
    classOrigin: bundle?.ir?.imports[className]?.origin ?? origin,
  }))
  if (bindings.length === 0) {
    return {
      status: 'available',
      items: [],
      selected: null,
      stale: null,
      truncated: false,
    }
  }

  const queried = await Promise.all(
    bindings.map(async (binding) => {
      const cypher = targetQuery(binding.className, binding.classOrigin)
      const result = await runAstraleJson<RawTargetRow[]>(
        ['query', '--cypher', cypher, '--json', '-i', instance],
        timeoutMs,
      )
      return { binding, result }
    }),
  )
  const successes = queried.filter((item) => item.result.ok && Array.isArray(item.result.data))
  if (successes.length === 0) {
    const reason = queried.map((item) => item.result.detail).find(Boolean)
    return {
      status: 'unavailable',
      items: [],
      selected: null,
      stale: null,
      truncated: false,
      reason: reason || 'The active instance could not be queried for view targets.',
    }
  }

  const byId = new Map<string, ViewTargetCandidate>()
  let truncated = false
  for (const { binding, result } of successes) {
    const rows = result.data ?? []
    if (rows.length > TARGET_LIMIT) truncated = true
    for (const row of rows.slice(0, TARGET_LIMIT)) {
      const target = targetFromRow(row, binding.className, binding.classOrigin)
      if (target) byId.set(target.id, target)
    }
  }
  const items = [...byId.values()].sort(
    (a, b) => a.label.localeCompare(b.label) || a.className.localeCompare(b.className),
  )
  const remembered = readRememberedTarget(root, instance, view.slug)
  const reconciled = reconcileRememberedTarget(remembered, items)
  return {
    status: 'available',
    items,
    ...reconciled,
    truncated,
  }
}

export function reconcileRememberedTarget(
  remembered: RememberedViewTarget | null,
  items: ViewTargetCandidate[],
): Pick<ViewTargetResult, 'selected' | 'stale'> {
  if (!remembered) return { selected: null, stale: null }
  const selected = items.find((item) => item.id === remembered.id) ?? null
  return { selected, stale: selected ? null : remembered }
}

export function targetFromRow(
  row: RawTargetRow,
  className: string,
  classOrigin: string,
): ViewTargetCandidate | null {
  const id =
    typeof row.id === 'string' ? row.id : typeof row.props?.id === 'string' ? row.props.id : ''
  if (!id) return null
  const props = row.props ?? {}
  const firstName = stringProp(props, ['.property.firstName'])
  const lastName = stringProp(props, ['.property.lastName'])
  const label =
    asNonEmptyString(props[NAMED_NAME]) ??
    stringProp(props, ['.property.title', '.property.label', '.property.name', '.property.slug']) ??
    ([firstName, lastName].filter(Boolean).join(' ') || `${className} · ${id.slice(0, 8)}`)
  return {
    id,
    ref: `@${id}`,
    className,
    classOrigin,
    label,
    description:
      asNonEmptyString(props[DESCRIPTABLE_DESCRIPTION]) ??
      stringProp(props, ['.property.description', '.property.email']),
    status: asNonEmptyString(props[STATUSED_STATUS]) ?? stringProp(props, ['.property.status']),
  }
}

export function targetQuery(className: string, classOrigin: string): string {
  const name = JSON.stringify(assertSchemaName(className))
  const origin = JSON.stringify(assertOrigin(classOrigin))
  return `MATCH (n:Node)-[:instance_of]->(c:Class)-[:of_domain]->(d:Domain) WHERE c.\`${NAMED_NAME}\` = ${name} AND (d.origin = ${origin} OR d.\`${NAMED_NAME}\` = ${origin} OR d.\`${DOMAIN_ORIGIN}\` = ${origin}) RETURN n.id AS id, n AS props LIMIT ${TARGET_LIMIT + 1}`
}

function viewClasses(view: ViewInfo): string[] {
  return Array.isArray(view.viewFor) ? view.viewFor : view.viewFor ? [view.viewFor] : []
}

function rememberTarget(
  root: string,
  instance: string,
  slug: string,
  target: ViewTargetCandidate,
): void {
  const stored = readJson<StoredViewState>(root, STATE_FILE, {})
  stored.targets ??= {}
  stored.targets[instance] ??= {}
  stored.targets[instance][slug] = {
    id: target.id,
    className: target.className,
    classOrigin: target.classOrigin,
    label: target.label,
  }
  writeJson(root, STATE_FILE, stored)
}

function readRememberedTarget(
  root: string,
  instance: string,
  slug: string,
): RememberedViewTarget | null {
  return readJson<StoredViewState>(root, STATE_FILE, {}).targets?.[instance]?.[slug] ?? null
}

function assertOrigin(value: string): string {
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(value)) throw new Error(`Invalid domain origin: ${value}`)
  return value
}

function assertSchemaName(value: string): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(value)) throw new Error(`Invalid class name: ${value}`)
  return value
}

function stringProp(props: Record<string, unknown>, suffixes: string[]): string | undefined {
  for (const suffix of suffixes) {
    for (const [key, value] of Object.entries(props)) {
      if (!key.endsWith(suffix)) continue
      const text = asNonEmptyString(value)
      if (text) return text
    }
  }
  return undefined
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function conciseCliFailure(raw: string): string | undefined {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const error = lines.find((line) => /^[A-Za-z_$][\w$]*(?:Error|Exception):\s+\S/.test(line))
  if (error) return error.slice(0, 600)
  const explicit = lines.find((line) => /^(?:error|failed):\s+\S/i.test(line))
  if (explicit) return explicit.slice(0, 600)
  const useful = lines.find(
    (line) =>
      !/^\d+\s+\|/.test(line) &&
      line !== '^' &&
      !/^at\s/.test(line) &&
      !/^Bun v\d/.test(line) &&
      !/^details?:\s*[{[]?$/i.test(line),
  )
  return useful?.slice(0, 600)
}

function runViewSessionCommand<T>(args: string[], timeoutMs: number): Promise<AstraleResult<T>> {
  const command = viewSessionCommandTail.then(
    () => runAstraleJson<T>(args, timeoutMs),
    () => runAstraleJson<T>(args, timeoutMs),
  )
  viewSessionCommandTail = command.then(
    () => undefined,
    () => undefined,
  )
  return command
}

async function runAstraleJson<T>(args: string[], timeoutMs: number): Promise<AstraleResult<T>> {
  try {
    const proc = Bun.spawn(['astrale', ...args], { stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        // Already exited.
      }
    }, timeoutMs)
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      let data: T | null = null
      try {
        data = JSON.parse(stdout) as T
      } catch {
        // The detail below remains useful for CLI failures and old versions.
      }
      const parsed = data as { message?: unknown; error?: unknown } | null
      const detail =
        asNonEmptyString(parsed?.message) ??
        asNonEmptyString(parsed?.error) ??
        conciseCliFailure(stderr) ??
        conciseCliFailure(stdout) ??
        ''
      return { ok: code === 0 && data !== null, data, detail }
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    return {
      ok: false,
      data: null,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}
