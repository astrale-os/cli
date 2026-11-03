/**
 * Routes of the read-only Kernel Domain (`/api/domain/@kernel/…`). It answers the reads a
 * schema canvas makes of any Domain: bundle, anatomy, comments, layout and visibility.
 * Layout and visibility are reader preferences kept on this machine. Everything that
 * would change the Kernel or address its sources is refused.
 */
import { join } from 'node:path'

import { getKernelBundle, kernelAnatomy } from '../introspect/kernel'
import { studioHome } from '../state/home'
import { decodeNodePositions, readLayout, resetLayout, setNodePositions } from '../state/layout'
import { normalizeVisibility, readVisibility, saveVisibility } from '../state/visibility'
import { badRequest, json, notFound, readJsonRecord } from './http'

/** Machine-side state of the Kernel canvas: a machine state root, written as it is. */
export function kernelStateRoot(): string {
  return join(studioHome(), 'kernel')
}

const readOnly = () => json({ error: 'The Kernel Domain is read-only in Studio.' }, 403)

export async function handleKernelRoute(req: Request, rest: string): Promise<Response> {
  const root = kernelStateRoot()

  if (rest === '/bundle' && req.method === 'GET') return json(await getKernelBundle())
  if (rest === '/anatomy' && req.method === 'GET') return json(kernelAnatomy())

  if (rest === '/comments') {
    if (req.method !== 'GET') return readOnly()
    const bundle = await getKernelBundle()
    return json({ schemaVersion: bundle.renderFingerprint, comments: [] })
  }

  if (rest === '/layout') {
    if (req.method === 'GET') return json(readLayout(root))
    const body = await readJsonRecord(req)
    if (body.action === 'set') {
      const bundle = await getKernelBundle()
      return json(
        setNodePositions(root, decodeNodePositions(body.positions), bundle.renderFingerprint),
      )
    }
    if (body.action === 'reset') {
      resetLayout(root)
      return json({ ok: true })
    }
    return badRequest('unknown layout action')
  }

  if (rest === '/visibility') {
    if (req.method === 'GET') return json(readVisibility(root))
    const body = await readJsonRecord(req)
    if (body.action === 'set') return json(saveVisibility(root, normalizeVisibility(body)))
    return badRequest('unknown visibility action')
  }

  return req.method === 'GET' ? notFound() : readOnly()
}
