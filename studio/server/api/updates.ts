/** CLI-owned update status and apply routes for one domain. */
import { applyUpdates, getUpdates } from '../workspace/updates'
import { json, type DomainRouteContext } from './http'

export async function handleUpdateRoute(context: DomainRouteContext): Promise<Response | null> {
  const { req, rest, handle } = context
  if (rest === '/updates' && req.method === 'GET') return json(await getUpdates(handle.root))
  if (rest === '/updates/apply' && req.method === 'POST') {
    return json(await applyUpdates(handle.root))
  }
  return null
}
