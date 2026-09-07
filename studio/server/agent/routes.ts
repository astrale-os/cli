import type { ChatInfo, HarnessPresence, HarnessStatus } from '../../shared/types'
import type { ChatResult } from './run/coordinator'

import { badRequest, json, notFound, type AgentRouteContext } from '../api/http'
import { asJsonRecord, asString } from '../json'
import { decodeAnchorRef } from '../state/comments'
import { type AskRequest, runAsk } from './ask'
import { handleBridge } from './bridge/routes'
import { inspectHarnessHealth } from './harness/adapter'
import { readModelCatalog } from './harness/catalog'
import {
  clearHarnessGateway,
  gatewayAudience,
  getHarnessGatewayState,
  setHarnessGateway,
} from './harness/gateway/config'
import { setHostToken } from './harness/gateway/token'
import { getHarnessById, listHarnesses, probeInstalledHarnesses } from './harness/registry'
import { getHarness, getHarnessSelection, resolveHarnessConfiguration } from './harness/selection'
import { emitStudioEvent } from './notify'
import { buildSystemPrompt } from './prompts/system'
import {
  cancelRun,
  chatHarness,
  chatModel,
  closeChat,
  dropQueued,
  editQueued,
  forgetChatOrigin,
  getHistory,
  getSessionId,
  getSnapshot,
  listChats,
  moveQueued,
  openChat,
  selectChat,
  sendQueuedNow,
  setSessionId,
  submitRun,
  switchChatHarness,
  updateChat,
} from './run/coordinator'
import { readUsage } from './run/usage'
import { NdjsonChannel } from './stream'
import { agentWorkspace } from './workspace'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Chat operations fail on user-supplied ids, so their errors are 400s, not 500s. */
function chatJson<T>(result: ChatResult<T>): Response {
  return result.ok ? json(result.value) : badRequest(result.error)
}

async function harnessPresence(id: string): Promise<HarnessPresence> {
  const harness = getHarnessById(id)
  const health = await inspectHarnessHealth(harness)
  return {
    id: harness.id,
    label: harness.label,
    bin: health.bin ?? harness.id,
    ok: health.ok,
    version: health.version,
    message: health.ok
      ? (health.detail ?? `Detected${health.version ? ` — ${health.version}` : ''}`)
      : (health.detail ?? `${harness.label} is not detected. Is it installed and on your PATH?`),
    capabilities: harness.capabilities,
  }
}

/**
 * The agent the next chat opens on, and every agent detected beside it.
 *
 * Both are probed on every read: the composer needs each one's reasoning ladder
 * before any of them is chosen, and Settings lists them as pure diagnostics. The
 * adapters cache their own ACP handshake, so this stays one cheap call.
 *
 * Probing comes FIRST, and the selection second. The selection is a synchronous
 * read of the last probe, so asking it before refreshing that would answer from
 * whatever this process last saw — and the agent that just got uninstalled would
 * keep being named until some later request happened to correct it.
 */
async function harnessStatus(): Promise<HarnessStatus> {
  const detected = await Promise.all(listHarnesses().map((entry) => harnessPresence(entry.id)))
  const selection = getHarnessSelection()
  // `listHarnesses` hides the mock agent unless it is the one running; when it is,
  // it belongs in the list too — it is what the reader is looking at.
  const selected =
    detected.find((entry) => entry.id === selection.id) ?? (await harnessPresence(selection.id))
  const harnesses = detected.includes(selected) ? detected : [...detected, selected]
  return {
    ...selected,
    harnesses,
    locked: selection.locked,
    source: selection.source,
    // the star, when it is on an agent this machine does not have: the GUI needs it
    // to say WHICH one it is waiting for, and to keep the star out of the picker
    ...(selection.preferred === undefined ? {} : { preferred: selection.preferred }),
  }
}

/**
 * Own every `/api/agent/*` HTTP route. There is one agent for the workspace, so
 * nothing here is addressed by domain: `rest` is the path after `/api`.
 */
export async function handleAgentRoute(input: AgentRouteContext): Promise<Response | null> {
  const { req, url, rest, body, notify } = input
  if (rest !== '/agent' && !rest.startsWith('/agent/')) return null
  const routeStarted = performance.now()
  // Nothing here may answer before the boot sweep has said which agents this
  // machine has: the routes below create the workspace's first chat, on the harness
  // the selection names, and a tab is written once. Memoized — this waits on the
  // sweep the server already started, and is free afterwards.
  await probeInstalledHarnesses()
  const sweepReady = performance.now()
  const workspace = agentWorkspace()
  const root = workspace.root

  // Every conversation route is chat-scoped; `?chat=` / `body.chatId` name the
  // tab, and omitting it means the one the user is looking at.
  const chatParam = asString(url.searchParams.get('chat') ?? undefined) || undefined
  const chatBody = asString(body.chatId) || undefined

  if (rest === '/agent') {
    if (req.method === 'GET') {
      const snapshot = await getSnapshot(chatParam)
      if (process.env.DOMAIN_STUDIO_TIMINGS === '1') {
        console.log(
          `    timing agent snapshot total=${Math.round((performance.now() - routeStarted) * 10) / 10}ms sweep-wait=${Math.round((sweepReady - routeStarted) * 10) / 10}ms snapshot=${Math.round((performance.now() - sweepReady) * 10) / 10}ms`,
        )
      }
      return json(snapshot)
    }
    return badRequest('use /agent/submit or /agent/cancel')
  }
  if (rest === '/agent/chats') {
    if (req.method === 'GET') return json(listChats())
    if (req.method === 'POST') {
      const harness = asString(body.harness)
      const title = asString(body.title)
      const model = asString(body.model)
      const effort = asString(body.effort)
      const newDomainId = asString(body.newDomainId)
      switch (asString(body.action) ?? 'open') {
        case 'open':
          return chatJson(
            openChat({
              ...(harness === undefined ? {} : { harness }),
              ...(title === undefined ? {} : { title }),
              ...(newDomainId === undefined ? {} : { newDomainId }),
            }),
          )
        case 'select':
          return chatJson(selectChat(chatBody ?? ''))
        case 'close':
          return chatJson(closeChat(chatBody ?? ''))
        case 'update':
          return chatJson(
            updateChat(chatBody ?? '', {
              ...(title === undefined ? {} : { title }),
              ...(model === undefined ? {} : { model }),
              ...(effort === undefined ? {} : { effort }),
            }),
          )
        case 'switch-harness':
          return chatJson(switchChatHarness(chatBody, harness ?? '', model))
        case 'forget-origin':
          return chatJson(forgetChatOrigin(chatBody ?? ''))
        default:
          return badRequest(`unknown chat action: ${asString(body.action) ?? ''}`)
      }
    }
    return badRequest('GET or POST')
  }
  if (rest === '/agent/submit' && req.method === 'POST') {
    // One envelope for both outcomes: a free chat runs the message, a busy one
    // parks it, and the composer must be able to tell which without guessing.
    return json(
      await submitRun(notify, {
        message: typeof body.message === 'string' ? body.message : undefined,
        resume: body.resume === true,
        ...(chatBody === undefined ? {} : { chatId: chatBody }),
      }),
    )
  }
  if (rest === '/agent/queue' && req.method === 'POST') {
    const messageId = asString(body.id) ?? ''
    // No run event announces a queue change, and every window shows the same
    // queue — so the tab strip has to be told to resync itself.
    const queued = (result: ChatResult<ChatInfo>): Response => {
      if (result.ok) emitStudioEvent(notify, { type: 'chats' })
      return chatJson(result)
    }
    // Adding is deliberately absent: a message enters the queue by being SENT
    // while a turn runs, so the composer has exactly one way to submit.
    switch (asString(body.action)) {
      case 'edit':
        return queued(editQueued(chatBody, messageId, asString(body.message) ?? ''))
      case 'remove':
        return queued(dropQueued(chatBody, messageId))
      case 'move':
        return queued(moveQueued(chatBody, messageId, body.direction === 'down' ? 'down' : 'up'))
      case 'send': {
        const result = await sendQueuedNow(notify, chatBody, messageId)
        return result.ok ? json(result.value) : badRequest(result.error)
      }
      default:
        return badRequest(`unknown queue action: ${asString(body.action) ?? ''}`)
    }
  }
  if (rest === '/agent/history' && req.method === 'GET')
    return chatJson(getHistory(chatParam, Number(url.searchParams.get('limit')) || undefined))
  if (rest === '/agent/cancel' && req.method === 'POST') return json({ ok: cancelRun(chatBody) })
  if (rest === '/agent/session') {
    if (req.method === 'GET') return json(getSessionId(chatParam))
    if (req.method === 'POST') {
      // The id belongs to ONE agent's conversation: refuse to graft a Codex thread
      // onto a Claude tab (and vice versa) rather than fail cryptically at resume.
      const expected = chatHarness(chatBody)
      const claimed = asString(body.harness)
      if (claimed && expected && claimed !== expected)
        return badRequest(`this chat runs ${expected}, not ${claimed}`)
      return chatJson(setSessionId(chatBody, asString(body.sessionId) ?? ''))
    }
    return badRequest('GET or POST')
  }
  if (rest === '/agent/prompt/system' && req.method === 'GET')
    return json({ bridge: true, systemPrompt: buildSystemPrompt({ bridge: true }) })
  if (rest === '/agent/harness' && req.method === 'GET') return json(await harnessStatus())
  if (rest === '/agent/models' && req.method === 'GET')
    return json(await readModelCatalog(root, req.signal))
  if (rest === '/agent/loadout' && req.method === 'GET') {
    // Probe the models of the chat's OWN harness — the default is only what a new
    // tab would get.
    const bound = chatHarness(chatParam)
    const harness = bound ? getHarnessById(bound) : getHarness()
    const override = chatModel(chatParam)
    if (!harness.loadout)
      return json({
        ok: false,
        detail: `${harness.label} does not expose ACP diagnostics`,
        probedAt: Date.now(),
        source: 'acp',
      })
    const configuration = await resolveHarnessConfiguration(harness, {
      ...(override ? { model: override } : {}),
    })
    if (!configuration.ok)
      return json({
        ok: false,
        detail: `model gateway auth failed — ${configuration.error}`,
        probedAt: Date.now(),
        source: 'acp',
      })
    const { env, model } = configuration.configuration
    return json(
      await harness.loadout(root, {
        env,
        model,
        refresh: url.searchParams.get('refresh') === '1',
        signal: req.signal,
      }),
    )
  }
  if (rest === '/agent/harness-gateway') {
    if (req.method === 'GET') return json(getHarnessGatewayState())
    if (req.method === 'POST') {
      if (body.action === 'set') {
        try {
          return json(setHarnessGateway(asJsonRecord(body.config) ?? {}))
        } catch (error) {
          return badRequest(errorMessage(error))
        }
      }
      if (body.action === 'clear') return json(clearHarnessGateway())
      return badRequest('unknown harness-gateway action')
    }
  }
  if (rest === '/agent/harness-gateway/host-token' && req.method === 'POST') {
    const audience = gatewayAudience()
    if (!audience) return badRequest('no gateway base URL configured')
    return json({ ok: setHostToken(audience, asString(body.token) ?? '') })
  }
  if (rest === '/agent/usage' && req.method === 'GET') return json(readUsage(workspace.stateRoot))
  if (rest === '/agent/ask' && req.method === 'POST') {
    const excerpt = asString(body.excerpt)
    const anchor = decodeAnchorRef(body.anchor)
    const domainId = asString(body.domainId)
    const ask: AskRequest = {
      question: asString(body.question) ?? '',
      ...(excerpt === undefined ? {} : { excerpt }),
      ...(anchor === undefined ? {} : { anchor }),
      ...(domainId === undefined ? {} : { domainId }),
      ...(chatBody === undefined ? {} : { chatId: chatBody }),
    }
    const controller = new AbortController()
    req.signal?.addEventListener('abort', () => controller.abort(), { once: true })
    let channel: NdjsonChannel | undefined
    const stream = new ReadableStream<Uint8Array>({
      async start(target) {
        channel = new NdjsonChannel(target, controller)
        try {
          const result = await runAsk(workspace, ask, controller.signal, (delta) =>
            channel!.send({ delta }),
          )
          channel.send(
            result.isError ? { error: result.errorMessage || 'ask failed' } : { done: result.text },
          )
        } catch (error) {
          channel.send({ error: errorMessage(error) })
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
    return handleBridge(rest.slice('/agent/bridge/'.length), body)

  return notFound()
}
