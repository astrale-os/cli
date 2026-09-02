/** Schema-anchored review comment routes and agent reply merge. */
import type { ThreadEntry } from '../../shared/types'

import { isConcreteAnchorRef } from '../../shared/comment-anchors'
import { getBundle } from '../cache'
import { schemaRefs } from '../introspect/schema-refs'
import { asJsonRecord, asString, asStringArray } from '../json'
import {
  addThreadEntry,
  decodeAnchorRefs,
  deleteComment,
  editThreadEntry,
  markOrphans,
  mergeReply,
  readComments,
  setStatus,
  upsertComment,
} from '../state/comments'
import { badRequest, json, notFound, type DomainRouteContext } from './http'

function replyEntry(value: unknown): Omit<ThreadEntry, 'id'> | undefined {
  const record = asJsonRecord(value)
  const text = asString(record?.text)
  const role = record?.role === 'author' ? 'author' : record?.role === 'user' ? 'user' : undefined
  if (!record || text === undefined || role === undefined) return undefined
  const type = record.type === 'choice' ? 'choice' : 'text'
  const options = asStringArray(record.options)
  const answer = record.answer === null ? null : asString(record.answer)
  return {
    role,
    type,
    text,
    ...(options === undefined ? {} : { options }),
    ...(answer === undefined ? {} : { answer }),
  }
}

export async function handleCommentRoute(context: DomainRouteContext): Promise<Response | null> {
  const { req, rest, body, handle, notify } = context
  const id = handle.id
  const root = handle.root

  if (rest === '/comments') {
    if (req.method === 'GET') {
      const bundle = await getBundle(id)
      const valid = new Set<string>(bundle ? schemaRefs(bundle) : [])
      for (const key of Object.keys(bundle?.overlay.sourceSpans ?? {})) valid.add(key)
      const store = readComments(root)
      for (const comment of store.comments) {
        for (const anchor of comment.anchorRefs) {
          if (anchor.kind !== 'schema') valid.add(anchor.ref)
        }
      }
      return json(markOrphans(root, [...valid]))
    }
    if (body.action === 'create') {
      const anchorRefs = decodeAnchorRefs(body.anchorRefs)
      if (anchorRefs.length === 0 || anchorRefs.some((anchor) => !isConcreteAnchorRef(anchor)))
        return badRequest('a concrete domain element is required')
      const bundle = await getBundle(id)
      const comment = upsertComment(root, {
        anchors: asStringArray(body.anchors) ?? [],
        anchorRefs,
        text: asString(body.text),
        firstRole:
          body.firstRole === 'author' ? 'author' : body.firstRole === 'user' ? 'user' : undefined,
        type: body.type === 'choice' ? 'choice' : body.type === 'text' ? 'text' : undefined,
        options: asStringArray(body.options),
        schemaVersion: bundle?.renderFingerprint,
      })
      notify({ type: 'comments', domainId: id })
      return json(comment)
    }
    if (body.action === 'reply') {
      const commentId = asString(body.id)
      const entry = replyEntry(body.entry)
      if (!commentId || !entry) return badRequest('id and a valid entry are required')
      const comment = addThreadEntry(root, commentId, entry)
      notify({ type: 'comments', domainId: id })
      return comment ? json(comment) : notFound()
    }
    if (body.action === 'edit') {
      const comment = editThreadEntry(
        root,
        asString(body.id) ?? '',
        asString(body.entryId) ?? '',
        asString(body.text) ?? '',
      )
      notify({ type: 'comments', domainId: id })
      return comment ? json(comment) : notFound()
    }
    if (body.action === 'status') {
      const status =
        body.status === 'closed' ? 'closed' : body.status === 'open' ? 'open' : undefined
      if (!status) return badRequest('status must be open or closed')
      const comment = setStatus(root, asString(body.id) ?? '', status, asString(body.closeNote))
      notify({ type: 'comments', domainId: id })
      return comment ? json(comment) : notFound()
    }
    if (body.action === 'delete') {
      const ok = deleteComment(root, asString(body.id) ?? '')
      notify({ type: 'comments', domainId: id })
      return json({ ok })
    }
    return badRequest('unknown comments action')
  }

  if (rest === '/comments/merge' && req.method === 'POST') {
    const bundle = await getBundle(id)
    try {
      const result = mergeReply(root, bundle?.renderFingerprint ?? '', asString(body.text) ?? '', {
        dedupeAuthorText: true,
      })
      notify({ type: 'comments', domainId: id })
      return json(result)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error))
    }
  }

  return null
}
