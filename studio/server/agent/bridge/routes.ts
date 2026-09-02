import type { StudioEvent } from '../../../shared/types'
import type { DomainHandle } from '../../domain'
import type { JsonRecord } from '../../json'
import type { AgentWorkspace } from '../workspace'

import { concreteAnchorKind } from '../../../shared/comment-anchors'
import { json } from '../../api/http'
import { asString, asStringArray } from '../../json'
import { addThreadEntry, readComments, setStatus, upsertComment } from '../../state/comments'
import { readContext } from '../../state/context'
import { listDocuments } from '../../state/documents'
import { emitStudioEvent } from '../notify'
import { domainOrigin, domainRelativePath, findDomain } from '../workspace'

interface RunBridge {
  workspace: AgentWorkspace
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

/** Open the authenticated write-back session owned by one agent run. */
export function openBridgeSession(
  workspace: AgentWorkspace,
  token: string,
  notify: (event: StudioEvent) => void,
): BridgeSession {
  const bridge: RunBridge = {
    workspace,
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
    invoke: (sub, body) => applyBridgeCall(sub, { ...body, token }),
    dispose: () => {
      bridges.delete(token)
    },
  }
}

/** Handle one token-guarded bridge route. */
export function handleBridge(sub: string, body: JsonRecord): Promise<Response> {
  return applyBridgeCall(sub, body)
}

/** Every open thread of one domain, regardless of whose turn it is. */
function openIn(handle: DomainHandle) {
  return readComments(handle.root).comments.filter((comment) => comment.status === 'open')
}

/** Which domain holds a comment — ids are uuids, so at most one does. */
function ownerOf(
  workspace: AgentWorkspace,
  commentId: string,
): { handle: DomainHandle } | undefined {
  for (const handle of workspace.domains) {
    if (readComments(handle.root).comments.some((comment) => comment.id === commentId))
      return { handle }
  }
  return undefined
}

async function applyBridgeCall(sub: string, body: JsonRecord): Promise<Response> {
  const token = asString(body.token) ?? ''
  const bridge = bridges.get(token)
  if (!bridge) return error('invalid or expired bridge token', 401)
  const { workspace } = bridge
  const describe = (handle: DomainHandle) => ({
    domain: domainOrigin(handle),
    path: domainRelativePath(workspace, handle),
  })
  const changed = (handle: DomainHandle) =>
    emitStudioEvent(bridge.notify, { type: 'comments', domainId: handle.id })

  switch (sub) {
    case 'domains':
      return json({
        domains: workspace.domains.map((handle) => {
          const open = openIn(handle)
          return {
            ...describe(handle),
            root: handle.root,
            openThreads: open.length,
            awaiting: open.filter((comment) => comment.thread.at(-1)?.role !== 'author').length,
          }
        }),
      })
    case 'threads': {
      const filter = asString(body.domain)?.trim()
      let handles = workspace.domains
      if (filter) {
        const handle = findDomain(workspace, filter)
        if (!handle) return error(`unknown domain: ${filter}`, 404)
        handles = [handle]
      }
      return json({
        threads: handles.flatMap((handle) =>
          openIn(handle).map((comment) => ({
            id: comment.id,
            ...describe(handle),
            kind: comment.kind,
            anchor: comment.anchorRefs?.[0]?.ref ?? null,
            file: comment.anchorRefs?.[0]?.file ?? null,
            latest: comment.thread.at(-1)?.text ?? '',
            waitingOn: comment.thread.at(-1)?.role === 'author' ? 'user' : 'agent',
          })),
        ),
      })
    }
    case 'context': {
      const reference = asString(body.domain)?.trim() ?? ''
      const handle = reference ? findDomain(workspace, reference) : undefined
      if (!handle)
        return error(reference ? `unknown domain: ${reference}` : 'domain is required', 404)
      const context = readContext(handle.root)
      return json({
        ...describe(handle),
        root: handle.root,
        documents: listDocuments(handle.root).map((doc) => ({
          name: doc.name,
          type: doc.type,
          size: doc.size,
          path: `.domain-studio/${doc.stored}`,
        })),
        notes: context.user.map((item) => ({ title: item.title, body: item.body })),
        auto: context.auto.map((item) => ({ title: item.title, body: item.body })),
      })
    }
    case 'reply': {
      const commentId = asString(body.commentId) ?? ''
      const text = (asString(body.text) ?? '').trim()
      if (!commentId || !text) return error('commentId and text are required')
      const owner = ownerOf(workspace, commentId)
      if (!owner) return error('unknown commentId', 404)
      const options = asStringArray(body.options)
      const answer = body.answer === null ? null : asString(body.answer)
      const comment = addThreadEntry(owner.handle.root, commentId, {
        role: 'author',
        type: options ? 'choice' : 'text',
        text,
        ...(options === undefined ? {} : { options }),
        ...(answer === undefined ? {} : { answer }),
      })
      if (!comment) return error('unknown commentId', 404)
      const closeNote = asString(body.closeNote)
      if (body.resolve === true) setStatus(owner.handle.root, commentId, 'closed', closeNote)
      bridge.onReply(commentId, text)
      changed(owner.handle)
      return json({ ok: true, resolved: body.resolve === true })
    }
    case 'resolve': {
      const commentId = asString(body.commentId) ?? ''
      if (!commentId) return error('commentId is required')
      const owner = ownerOf(workspace, commentId)
      if (!owner) return error('unknown commentId', 404)
      const closeNote = asString(body.closeNote)
      const comment = setStatus(owner.handle.root, commentId, 'closed', closeNote)
      if (!comment) return error('unknown commentId', 404)
      bridge.onReply(commentId, closeNote ? `resolved: ${closeNote}` : 'resolved')
      changed(owner.handle)
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
      const kind = concreteAnchorKind(ref)
      if (!kind) return error('ref must identify a concrete domain element')
      const reference = asString(body.domain)?.trim() ?? ''
      // Domain is always explicit: the same tool call must mean the same thing when
      // another domain is added to the workspace later in the conversation.
      const handle = reference ? findDomain(workspace, reference) : undefined
      if (!handle)
        return error(
          reference ? `unknown domain: ${reference}` : 'domain is required (origin or path)',
          reference ? 404 : 400,
        )
      const options = asStringArray(body.options)
      const file = asString(body.file)
      const comment = upsertComment(handle.root, {
        anchors: [asString(body.label) ?? ref],
        anchorRefs: [{ ref, kind, ...(file ? { file } : {}) }],
        text,
        firstRole: 'author',
        type: options ? 'choice' : 'text',
        options,
      })
      changed(handle)
      return json({ ok: true, id: comment.id, ...describe(handle) })
    }
    default:
      return error('unknown bridge route', 404)
  }
}
