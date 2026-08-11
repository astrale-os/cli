import type { StudioEvent } from '../../../shared/types'
import type { DomainHandle } from '../../domain'

import { addThreadEntry, readComments, setStatus, upsertComment } from '../../state/comments'
import { emitStudioEvent } from '../notify'

interface RunBridge {
  domainId: string
  root: string
  notify: (event: StudioEvent) => void
  onReply: (commentId: string, text: string) => void
  onProgress: (text: string) => void
}

export interface BridgeSession {
  token: string
  onReply(callback: (commentId: string, text: string) => void): void
  onProgress(callback: (text: string) => void): void
  invoke(sub: string, body: Record<string, unknown>): Promise<Response>
  dispose(): void
}

const bridges = new Map<string, RunBridge>()

function ok(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function error(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Open the authenticated write-back session owned by one agent run. */
export function openBridgeSession(
  handle: DomainHandle,
  token: string,
  notify: (event: StudioEvent) => void,
): BridgeSession {
  const bridge: RunBridge = {
    domainId: handle.id,
    root: handle.root,
    notify,
    onReply: () => {},
    onProgress: () => {},
  }
  bridges.set(token, bridge)
  return {
    token,
    onReply: (callback) => {
      bridge.onReply = callback
    },
    onProgress: (callback) => {
      bridge.onProgress = callback
    },
    invoke: (sub, body) => applyBridgeCall(handle, sub, { ...body, token }),
    dispose: () => {
      bridges.delete(token)
    },
  }
}

/** Handle one token-guarded bridge route. */
export function handleBridge(
  handle: DomainHandle,
  sub: string,
  _req: Request,
  body: any,
): Promise<Response> {
  return applyBridgeCall(handle, sub, body)
}

async function applyBridgeCall(handle: DomainHandle, sub: string, body: any): Promise<Response> {
  const token = String(body?.token ?? '')
  const bridge = bridges.get(token)
  if (!bridge || bridge.domainId !== handle.id) return error('invalid or expired bridge token', 401)
  const root = bridge.root

  switch (sub) {
    case 'threads': {
      const open = readComments(root).comments.filter(
        (comment) => comment.status === 'open' && comment.thread.at(-1)?.role !== 'author',
      )
      return ok({
        threads: open.map((comment) => ({
          id: comment.id,
          kind: comment.kind,
          anchor: comment.anchorRefs?.[0]?.ref ?? null,
          file: comment.anchorRefs?.[0]?.file ?? null,
          latest: comment.thread.at(-1)?.text ?? '',
        })),
      })
    }
    case 'reply': {
      const commentId = String(body.commentId ?? '')
      const text = String(body.text ?? '').trim()
      if (!commentId || !text) return error('commentId and text are required')
      const comment = addThreadEntry(root, commentId, {
        role: 'author',
        type: body.options ? 'choice' : 'text',
        text,
        options: body.options,
        answer: body.answer,
      })
      if (!comment) return error('unknown commentId', 404)
      if (body.resolve) setStatus(root, commentId, 'closed', body.closeNote)
      bridge.onReply(commentId, text)
      emitStudioEvent(bridge.notify, { type: 'comments', domainId: handle.id })
      return ok({ ok: true, resolved: !!body.resolve })
    }
    case 'resolve': {
      const commentId = String(body.commentId ?? '')
      if (!commentId) return error('commentId is required')
      const comment = setStatus(root, commentId, 'closed', body.closeNote)
      if (!comment) return error('unknown commentId', 404)
      bridge.onReply(commentId, body.closeNote ? `resolved: ${body.closeNote}` : 'resolved')
      emitStudioEvent(bridge.notify, { type: 'comments', domainId: handle.id })
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
      if (!ref || !text) return error('ref and text are required')
      const comment = upsertComment(root, {
        anchors: [body.label ?? ref],
        anchorRefs: [{ ref, kind: (body.kind ?? 'schema') as any, file: body.file }],
        text,
        firstRole: 'author',
        type: body.options ? 'choice' : 'text',
        options: body.options,
      })
      emitStudioEvent(bridge.notify, { type: 'comments', domainId: handle.id })
      return ok({ ok: true, id: comment.id })
    }
    default:
      return error('unknown bridge route', 404)
  }
}
