import type { AnchorKind, StudioEvent } from '../../../shared/types'
import type { DomainHandle } from '../../domain'
import type { JsonRecord } from '../../json'

import { json } from '../../api/http'
import { asString, asStringArray } from '../../json'
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
  invoke(sub: string, body: JsonRecord): Promise<Response>
  dispose(): void
}

const bridges = new Map<string, RunBridge>()

function error(message: string, status = 400): Response {
  return json({ error: message }, status)
}

function anchorKind(value: unknown): AnchorKind {
  return value === 'section' || value === 'file' || value === 'free' ? value : 'schema'
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
  body: JsonRecord,
): Promise<Response> {
  return applyBridgeCall(handle, sub, body)
}

async function applyBridgeCall(
  handle: DomainHandle,
  sub: string,
  body: JsonRecord,
): Promise<Response> {
  const token = asString(body.token) ?? ''
  const bridge = bridges.get(token)
  if (!bridge || bridge.domainId !== handle.id) return error('invalid or expired bridge token', 401)
  const root = bridge.root

  switch (sub) {
    case 'threads': {
      const open = readComments(root).comments.filter(
        (comment) => comment.status === 'open' && comment.thread.at(-1)?.role !== 'author',
      )
      return json({
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
      const commentId = asString(body.commentId) ?? ''
      const text = (asString(body.text) ?? '').trim()
      if (!commentId || !text) return error('commentId and text are required')
      const options = asStringArray(body.options)
      const answer = body.answer === null ? null : asString(body.answer)
      const comment = addThreadEntry(root, commentId, {
        role: 'author',
        type: options ? 'choice' : 'text',
        text,
        ...(options === undefined ? {} : { options }),
        ...(answer === undefined ? {} : { answer }),
      })
      if (!comment) return error('unknown commentId', 404)
      const closeNote = asString(body.closeNote)
      if (body.resolve === true) setStatus(root, commentId, 'closed', closeNote)
      bridge.onReply(commentId, text)
      emitStudioEvent(bridge.notify, { type: 'comments', domainId: handle.id })
      return json({ ok: true, resolved: body.resolve === true })
    }
    case 'resolve': {
      const commentId = asString(body.commentId) ?? ''
      if (!commentId) return error('commentId is required')
      const closeNote = asString(body.closeNote)
      const comment = setStatus(root, commentId, 'closed', closeNote)
      if (!comment) return error('unknown commentId', 404)
      bridge.onReply(commentId, closeNote ? `resolved: ${closeNote}` : 'resolved')
      emitStudioEvent(bridge.notify, { type: 'comments', domainId: handle.id })
      return json({ ok: true })
    }
    case 'progress': {
      const text = (asString(body.text) ?? '').trim()
      if (text) bridge.onProgress(text)
      return json({ ok: true })
    }
    case 'raise_question': {
      const ref = asString(body.ref) ?? ''
      const text = (asString(body.text) ?? '').trim()
      if (!ref || !text) return error('ref and text are required')
      const options = asStringArray(body.options)
      const file = asString(body.file)
      const comment = upsertComment(root, {
        anchors: [asString(body.label) ?? ref],
        anchorRefs: [{ ref, kind: anchorKind(body.kind), ...(file ? { file } : {}) }],
        text,
        firstRole: 'author',
        type: options ? 'choice' : 'text',
        options,
      })
      emitStudioEvent(bridge.notify, { type: 'comments', domainId: handle.id })
      return json({ ok: true, id: comment.id })
    }
    default:
      return error('unknown bridge route', 404)
  }
}
