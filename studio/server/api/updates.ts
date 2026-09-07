/** Read-only CLI-owned update status for one domain. */
import { getUpdates } from '../workspace/updates'
import { json, type DomainRouteContext } from './http'

export async function handleUpdateRoute(context: DomainRouteContext): Promise<Response | null> {
  const { req, rest, handle } = context
  if (rest === '/updates' && req.method === 'GET') return json(await getUpdates(handle.root))
  return null
}
