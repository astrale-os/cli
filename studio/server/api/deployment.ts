/** CLI-owned update, installation status, and deploy routes for one domain. */
import { getAnatomy, getBundle } from '../cache'
import { runDeploy } from '../instances/deploy'
import { instanceStatus } from '../instances/status'
import { applyUpdates, getUpdates } from '../workspace/updates'
import { json, type DomainRouteContext } from './http'

function instanceTarget(prodTarget?: string): string | null {
  const match = prodTarget?.match(/^instance:\s*(.+)$/)
  return match ? match[1].trim() || null : null
}

export async function handleDeploymentRoute(context: DomainRouteContext): Promise<Response | null> {
  const { req, rest, handle } = context
  if (rest === '/updates' && req.method === 'GET') return json(await getUpdates(handle.root))
  if (rest === '/updates/apply' && req.method === 'POST') {
    return json(await applyUpdates(handle.root))
  }

  if (rest === '/instance') {
    const target = instanceTarget((await getAnatomy(handle.id))?.overview.prodTarget)
    const bundle = await getBundle(handle.id)
    return json(
      await instanceStatus(
        handle,
        target,
        bundle?.ir?.domain ?? handle.origin ?? null,
        bundle?.schemaRevision ?? null,
      ),
    )
  }

  if (rest === '/instance/deploy' && req.method === 'POST') {
    const bundle = await getBundle(handle.id)
    return json(await runDeploy(handle, bundle?.renderFingerprint ?? null))
  }

  return null
}
