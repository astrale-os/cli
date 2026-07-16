/**
 * agent/bridge.ts — the per-run write-back channel. Lets the agent reply to
 * threads LIVE (mid-turn) instead of only at end-of-turn. Two halves:
 *
 *   1. startBridge() mints a scoped token + writes an MCP config the harness
 *      loads (`--mcp-config`). The MCP server (bridge-mcp.ts) is a thin stdio
 *      proxy: each tool call POSTs to the token-guarded routes below.
 *   2. handleBridge() applies those calls to the SAME state the GUI reads
 *      (comments.json), so replies appear in the threads immediately over SSE.
 *
 * This is additive: the runner ALSO merges the agent's end-of-turn machine-state
 * block, and mergeReply dedupes by text so a live reply is never duplicated.
 */
import { randomUUID } from 'node:crypto'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'

import type { StudioEvent } from '../../shared/types'
import type { DomainHandle } from '../domain'
import type { HarnessMcpServer } from './types'

import { addThreadEntry, readComments, setStatus, upsertComment } from '../state/comments'
import { removeState, statePath, writeJson } from '../state/store'

export interface Bridge {
  enabled: boolean
  mcpServers: HarnessMcpServer[]
  onReply(cb: (commentId: string, text: string) => void): void
  onProgress(cb: (text: string) => void): void
  dispose(): void
}

interface RunBridge {
  domainId: string
  root: string
  onReply: (commentId: string, text: string) => void
  onProgress: (text: string) => void
}

const bridges = new Map<string, RunBridge>() // token → bridge

let studioPort = Number(process.env.PORT) || 4319
/** index.ts calls this once the server is listening so the MCP proxy knows where to POST. */
export function setBridgePort(port: number): void {
  studioPort = port
}

const MCP_SERVER = join(import.meta.dir, 'bridge-mcp.ts')
// the studio runs under bun, so process.execPath is the absolute bun binary —
// robust when `bun` is only a shell function on the agent's PATH.
const BIN = process.env.DOMAIN_STUDIO_BRIDGE_BUN || process.execPath

export function startBridge(
  handle: DomainHandle,
  _getRunId: () => string,
  _notify: (e: StudioEvent) => void,
): Bridge {
  const token = randomUUID()
  const fileId = randomUUID()
  const holder: RunBridge = {
    domainId: handle.id,
    root: handle.root,
    onReply: () => {},
    onProgress: () => {},
  }
  bridges.set(token, holder)

  const base = `http://127.0.0.1:${studioPort}/api/domain/${encodeURIComponent(handle.id)}/agent/bridge`
  // Keep the bearer inside a state file. The path is safe to place in harness
  // argv/config, unlike the token itself (which would be visible through `ps`).
  const bridgeRel = `.cache/agent/bridge-${fileId}.json`
  writeJson(handle.root, bridgeRel, { base, token })
  const bridgeConfigPath = statePath(handle.root, bridgeRel)
  chmodSync(bridgeConfigPath, 0o600)
  const mcpServers: HarnessMcpServer[] = [
    {
      name: 'domain-studio',
      command: BIN,
      args: [MCP_SERVER, '--config', bridgeConfigPath],
      required: true,
      approvalMode: 'approve',
      enabledTools: [
        'list_open_threads',
        'reply_to_thread',
        'resolve_thread',
        'post_progress',
        'raise_question',
      ],
    },
  ]

  return {
    enabled: true,
    mcpServers,
    onReply: (cb) => {
      holder.onReply = cb
    },
    onProgress: (cb) => {
      holder.onProgress = cb
    },
    dispose: () => {
      bridges.delete(token)
      try {
        removeState(handle.root, bridgeRel)
      } catch {
        /* best-effort */
      }
    },
  }
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
function err(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Routes under /api/domain/:id/agent/bridge/<sub>. Token in the body, scoped to the run. */
export async function handleBridge(
  handle: DomainHandle,
  sub: string,
  _req: Request,
  body: any,
  notify: (e: StudioEvent) => void,
): Promise<Response> {
  const token = String(body?.token ?? '')
  const bridge = bridges.get(token)
  if (!bridge || bridge.domainId !== handle.id) return err('invalid or expired bridge token', 401)
  const root = handle.root

  switch (sub) {
    case 'threads': {
      const open = readComments(root).comments.filter(
        (c) => c.status === 'open' && c.thread.at(-1)?.role !== 'author',
      )
      return ok({
        threads: open.map((c) => ({
          id: c.id,
          kind: c.kind,
          anchor: c.anchorRefs?.[0]?.ref ?? null,
          file: c.anchorRefs?.[0]?.file ?? null,
          latest: c.thread.at(-1)?.text ?? '',
        })),
      })
    }
    case 'reply': {
      const commentId = String(body.commentId ?? '')
      const text = String(body.text ?? '').trim()
      if (!commentId || !text) return err('commentId and text are required')
      const c = addThreadEntry(root, commentId, {
        role: 'author',
        type: body.options ? 'choice' : 'text',
        text,
        options: body.options,
        answer: body.answer,
      })
      if (!c) return err('unknown commentId', 404)
      if (body.resolve) setStatus(root, commentId, 'closed', body.closeNote)
      bridge.onReply(commentId, text)
      notify({ type: 'comments', domainId: handle.id })
      return ok({ ok: true, resolved: !!body.resolve })
    }
    case 'resolve': {
      const commentId = String(body.commentId ?? '')
      if (!commentId) return err('commentId is required')
      const c = setStatus(root, commentId, 'closed', body.closeNote)
      if (!c) return err('unknown commentId', 404)
      bridge.onReply(commentId, body.closeNote ? `resolved: ${body.closeNote}` : 'resolved')
      notify({ type: 'comments', domainId: handle.id })
      return ok({ ok: true })
    }
    case 'progress': {
      const text = String(body.text ?? '').trim()
      if (text) bridge.onProgress(text)
      return ok({ ok: true })
    }
    case 'raise_question': {
      const ref = String(body.ref ?? '')
      const text = String(body.text ?? '').trim()
      if (!ref || !text) return err('ref and text are required')
      const c = upsertComment(root, {
        anchors: [body.label ?? ref],
        anchorRefs: [{ ref, kind: (body.kind ?? 'schema') as any, file: body.file }],
        text,
        firstRole: 'author',
        type: body.options ? 'choice' : 'text',
        options: body.options,
      })
      notify({ type: 'comments', domainId: handle.id })
      return ok({ ok: true, id: c.id })
    }
    default:
      return err('unknown bridge route', 404)
  }
}
