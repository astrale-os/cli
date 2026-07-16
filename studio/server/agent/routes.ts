import type { HarnessStatus, StudioEvent } from '../../shared/types'
import type { DomainHandle } from '../domain'

import { runAsk } from './ask'
import { handleBridge } from './bridge/routes'
import { inspectHarnessHealth } from './harness/adapter'
import {
  clearHarnessGateway,
  gatewayAudience,
  getHarnessGatewayState,
  setHarnessGateway,
} from './harness/gateway/config'
import { setHostToken } from './harness/gateway/token'
import { listHarnesses } from './harness/registry'
import {
  getHarness,
  getHarnessSelection,
  resolveHarnessConfiguration,
  setHarnessSelection,
} from './harness/selection'
import { buildSystemPrompt } from './prompts/system'
import {
  cancelRun,
  getSessionId,
  getSnapshot,
  isRunning,
  resetConversation,
  setSessionId,
  submitRun,
} from './run/coordinator'
import { readUsage } from './run/usage'
import { NdjsonChannel } from './stream'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const badRequest = (message: string) => json({ error: message }, 400)
const notFound = () => json({ error: 'not found' }, 404)

async function harnessStatus(root: string, selected = false): Promise<HarnessStatus> {
  const selection = getHarnessSelection(root)
  const harness = getHarness(root)
  const health = await inspectHarnessHealth(harness)
  return {
    id: harness.id,
    label: harness.label,
    bin: health.bin ?? harness.id,
    ok: health.ok,
    version: health.version,
    message: health.ok
      ? `${selected ? `Selected ${harness.label}` : 'Detected'}${health.version ? ` — ${health.version}` : ''}`
      : (health.detail ?? `${harness.label} is not detected. Is it installed and on your PATH?`),
    options: listHarnesses(harness.id),
    locked: selection.locked,
    source: selection.source,
    capabilities: harness.capabilities,
  }
}

export interface AgentRouteInput {
  req: Request
  url: URL
  rest: string
  body: any
  handle: DomainHandle
  notify: (event: StudioEvent) => void
}

/** Own every `/agent/*` HTTP route for one Studio domain. */
export async function handleAgentRoute(input: AgentRouteInput): Promise<Response | null> {
  const { req, url, rest, body, handle, notify } = input
  if (rest !== '/agent' && !rest.startsWith('/agent/')) return null
  const id = handle.id
  const root = handle.root

  if (rest === '/agent') {
    if (req.method === 'GET') return json(await getSnapshot(id))
    return badRequest('use /agent/submit or /agent/cancel')
  }
  if (rest === '/agent/submit' && req.method === 'POST') {
    const result = await submitRun(handle, notify, {
      message: typeof body.message === 'string' ? body.message : undefined,
      resume: body.resume === true,
    })
    return result.error ? json({ error: result.error }) : json(result.run)
  }
  if (rest === '/agent/cancel' && req.method === 'POST') return json({ ok: cancelRun(id) })
  if (rest === '/agent/reset' && req.method === 'POST') return json({ ok: resetConversation(id) })
  if (rest === '/agent/session') {
    if (req.method === 'GET') return json(getSessionId(id))
    if (req.method === 'POST') {
      const harness = getHarness(root)
      if (body.harness !== harness.id)
        return badRequest(
          `selected harness changed from ${String(body.harness ?? '(unknown)')} to ${harness.id}`,
        )
      const ok = setSessionId(id, typeof body.sessionId === 'string' ? body.sessionId : '')
      if (!ok) return badRequest('the session id cannot be changed while a turn is running')
      return json(getSessionId(id))
    }
    return badRequest('GET or POST')
  }
  if (rest === '/agent/prompt/system' && req.method === 'GET')
    return json({ bridge: true, systemPrompt: buildSystemPrompt({ bridge: true }) })
  if (rest === '/agent/harness' && req.method === 'GET') return json(await harnessStatus(root))
  if (rest === '/agent/harness' && req.method === 'POST') {
    if (isRunning(id)) return badRequest('the harness cannot be changed while a turn is running')
    try {
      setHarnessSelection(root, String(body.id ?? ''))
      return json(await harnessStatus(root, true))
    } catch (error) {
      return badRequest(String((error as Error)?.message ?? error))
    }
  }
  if (rest === '/agent/loadout' && req.method === 'GET') {
    const harness = getHarness(root)
    if (!harness.loadout)
      return json({
        ok: false,
        detail: `${harness.label} does not expose a loadout`,
        tools: [],
        mcpServers: [],
        skills: [],
        agents: [],
        builtinCommandCount: 0,
        probedAt: Date.now(),
      })
    const configuration = await resolveHarnessConfiguration(root, harness)
    if (!configuration.ok)
      return json({
        ok: false,
        detail: `model gateway auth failed — ${configuration.error}`,
        tools: [],
        mcpServers: [],
        skills: [],
        agents: [],
        builtinCommandCount: 0,
        probedAt: Date.now(),
      })
    const { env, model } = configuration.configuration
    return json(
      await harness.loadout(root, {
        env,
        model,
        refresh: url.searchParams.get('refresh') === '1',
      }),
    )
  }
  if (rest === '/agent/harness-gateway') {
    if (req.method === 'GET') return json(getHarnessGatewayState(root))
    if (req.method === 'POST') {
      const scope = body.scope === 'global' ? 'global' : 'domain'
      if (body.action === 'set') {
        try {
          return json(setHarnessGateway(root, { scope, config: body.config ?? {} }))
        } catch (error) {
          return badRequest(String((error as Error)?.message ?? error))
        }
      }
      if (body.action === 'clear') return json(clearHarnessGateway(root, scope))
      return badRequest('unknown harness-gateway action')
    }
  }
  if (rest === '/agent/harness-gateway/host-token' && req.method === 'POST') {
    const audience = gatewayAudience(root)
    if (!audience) return badRequest('no gateway base URL configured for this domain')
    return json({ ok: setHostToken(audience, String(body.token ?? '')) })
  }
  if (rest === '/agent/usage' && req.method === 'GET') return json(readUsage(root))
  if (rest === '/agent/skill' && req.method === 'GET') {
    const command = url.searchParams.get('command')
    const harness = getHarness(root)
    if (!command || !harness.skillContent) return notFound()
    const content = await harness.skillContent(root, command)
    return content ? json(content) : notFound()
  }
  if (rest === '/agent/ask' && req.method === 'POST') {
    const controller = new AbortController()
    req.signal?.addEventListener('abort', () => controller.abort(), { once: true })
    let channel: NdjsonChannel | undefined
    const stream = new ReadableStream<Uint8Array>({
      async start(target) {
        channel = new NdjsonChannel(target, controller)
        try {
          const result = await runAsk(handle, body, controller.signal, (delta) =>
            channel!.send({ delta }),
          )
          channel.send(
            result.isError ? { error: result.errorMessage || 'ask failed' } : { done: result.text },
          )
        } catch (error: any) {
          channel.send({ error: String(error?.message ?? error) })
        } finally {
          channel.close()
        }
      },
      cancel() {
        channel?.cancel()
        if (!channel) controller.abort()
      },
    })
    return new Response(stream, {
      headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' },
    })
  }
  if (rest.startsWith('/agent/bridge/'))
    return handleBridge(handle, rest.slice('/agent/bridge/'.length), req, body)

  return notFound()
}
