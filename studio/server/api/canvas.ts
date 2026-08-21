/** Persisted canvas layout and visibility preference routes. */
import { getBundle } from '../cache'
import { readLayout, resetLayout, saveLayout, setNodePositions } from '../state/layout'
import { readVisibility, resetVisibility, saveVisibility } from '../state/visibility'
import { badRequest, json, type DomainRouteContext } from './http'

export async function handleCanvasRoute(context: DomainRouteContext): Promise<Response | null> {
  const { req, rest, body, handle } = context
  const id = handle.id
  const root = handle.root

  if (rest === '/layout') {
    const bundle = await getBundle(id)
    if (req.method === 'GET') return json(readLayout(root))
    if (body.action === 'set') {
      return json(setNodePositions(root, body.positions ?? {}, bundle?.renderFingerprint))
    }
    if (body.action === 'save') {
      return json(saveLayout(root, body.positions ?? {}, bundle?.renderFingerprint))
    }
    if (body.action === 'reset') {
      resetLayout(root)
      return json({ ok: true })
    }
    return badRequest('unknown layout action')
  }

  if (rest === '/visibility') {
    if (req.method === 'GET') return json(readVisibility(root))
    if (body.action === 'set') {
      return json(
        saveVisibility(root, {
          hidden: body.hidden ?? {},
          showInheritedEdges: body.showInheritedEdges ?? true,
          materializedInterfaces: body.materializedInterfaces ?? {},
        }),
      )
    }
    if (body.action === 'reset') return json(resetVisibility(root))
    return badRequest('unknown visibility action')
  }

  return null
}
