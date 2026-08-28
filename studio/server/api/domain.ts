import type { DomainHandle } from '../domain'
import type { DomainRouteContext, Notify } from './http'

/** Domain-scoped route composition and the multipart/JSON body boundary. */
import { handleAgentRoute } from '../agent/routes'
import { handleCanvasRoute } from './canvas'
import { handleCommentRoute } from './comments'
import { handleDocumentMutation, handleDocumentTransport } from './documents'
import { notFound, readJsonRecord } from './http'
import { handleProjectRoute } from './project'
import { handleSchemaRoute } from './schema'
import { handleUpdateRoute } from './updates'
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

  const agent = await handleAgentRoute(context)
  if (agent) return agent

  const project = await handleProjectRoute(context)
  if (project) return project

  const canvas = await handleCanvasRoute(context)
  if (canvas) return canvas

  return notFound()
}
