/** Canonical schema, anatomy, and genesis inspection routes. */
import { getAnatomy, getBundle, getCore } from '../cache'
import { json, type DomainRouteContext } from './http'

export async function handleSchemaRoute(context: DomainRouteContext): Promise<Response | null> {
  const { rest, url, handle } = context
  const fresh = url.searchParams.has('fresh')
  if (rest === '/bundle') return json(await getBundle(handle.id, fresh))
  if (rest === '/anatomy') return json(await getAnatomy(handle.id, fresh))
  if (rest === '/core') return json(await getCore(handle.id, fresh))
  return null
}
