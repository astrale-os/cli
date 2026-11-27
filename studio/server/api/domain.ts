import type { DomainHandle } from '../domain/registry'
import type { DomainRouteContext, Notify } from './http'

/** Domain-scoped route composition and the multipart/JSON body boundary. */
import { getBundle } from '../introspect/cache'
import { handleCommentRoute } from './comments'
import { handleDocumentMutation, handleDocumentTransport } from './documents'
import { notFound, readJsonRecord } from './http'
import { handleLayoutRoute } from './layout'
import { handleProjectRoute } from './project'
import { handleScenarioRoute } from './scenarios'
import { handleSchemaRoute } from './schema'
import { handleUpdateRoute } from './updates'
import { handleDomainVersionsRoute } from './versions'
import { handleViewRoute } from './views'

export async function handleDomainRoute(input: {
  req: Request
  url: URL
  rest: string
  handle: DomainHandle
  notify: Notify
}): Promise<Response> {
  const { req, url, rest, handle, notify } = input

  const documentTransport = await handleDocumentTransport(req, rest, handle.root)
  if (documentTransport) return documentTransport

  const body = req.method === 'POST' ? await readJsonRecord(req) : {}
  const context: DomainRouteContext = { req, url, rest, body, handle, notify }

  const documentMutation = handleDocumentMutation(context)
  if (documentMutation) return documentMutation

  const schema = await handleSchemaRoute(context)
  if (schema) return schema

  const update = await handleUpdateRoute(context)
  if (update) return update

  const view = await handleViewRoute(context)
  if (view) return view

  const comment = await handleCommentRoute(context)
  if (comment) return comment

  const project = await handleProjectRoute(context)
  if (project) return project

  if (rest === '/layout')
    return handleLayoutRoute(
      req,
      handle.root,
      body,
      async () => (await getBundle(handle.id))?.renderFingerprint,
    )

  if (rest === '/scenarios')
    return handleScenarioRoute(req, handle.root, body, (store) =>
      notify({ type: 'scenarios', domainId: handle.id, revisions: store.revisions }),
    )

  const versions = await handleDomainVersionsRoute(context)
  if (versions) return versions

  return notFound()
}
