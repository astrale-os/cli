/** Canonical schema, anatomy, and Dataset inspection routes. */
import { getAnatomy, getBundle, getDatasets } from '../introspect/cache'
import { json, type DomainRouteContext } from './http'

export async function handleSchemaRoute(context: DomainRouteContext): Promise<Response | null> {
  const { rest, url, handle } = context
  const fresh = url.searchParams.has('fresh')
  if (rest === '/bundle') {
    const priority = url.searchParams.get('priority') === 'background' ? 'background' : 'reader'
    return json(await getBundle(handle.id, fresh, priority))
  }
  if (rest === '/anatomy') return json(await getAnatomy(handle.id, fresh))
  if (rest === '/datasets') return json(await getDatasets(handle.id, fresh))
  return null
}
