/** Persisted canvas layout and visibility preference routes. */
import { getBundle } from '../cache'
import {
  decodeNodePositions,
  readLayout,
  resetLayout,
  saveLayout,
  setNodePositions,
} from '../state/layout'
import { normalizeVisibility, readVisibility, saveVisibility } from '../state/visibility'
import { badRequest, json, type DomainRouteContext } from './http'

export async function handleCanvasRoute(context: DomainRouteContext): Promise<Response | null> {
  const { req, rest, body, handle } = context
  const id = handle.id
  const root = handle.root

  if (rest === '/layout') {
    const bundle = await getBundle(id)
    if (req.method === 'GET') return json(readLayout(root))
    if (body.action === 'set') {
      return json(
        setNodePositions(root, decodeNodePositions(body.positions), bundle?.renderFingerprint),
      )
    }
    if (body.action === 'save') {
      return json(saveLayout(root, decodeNodePositions(body.positions), bundle?.renderFingerprint))
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
      return json(saveVisibility(root, normalizeVisibility(body)))
    }
    return badRequest('unknown visibility action')
  }

  return null
}
