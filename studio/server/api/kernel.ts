/**
 * Routes of the read-only Kernel Domain (`/api/domain/@kernel/…`). It answers the reads a
 * schema canvas makes of any Domain: bundle, anatomy, comments and layout. Its layout is the
 * reader's, kept on this machine. Every other write is refused before it reaches here
 * (`readOnlyRefusal` in `api.ts`).
 */
import { join } from 'node:path'

import { getKernelBundle, kernelAnatomy } from '../introspect/kernel'
import { studioHome } from '../state/home'
import { json, notFound, readJsonRecord } from './http'
import { handleLayoutRoute } from './layout'

/** Machine-side state of the Kernel canvas: a machine state root, written as it is. */
export function kernelStateRoot(): string {
  return join(studioHome(), 'kernel')
}

export async function handleKernelRoute(req: Request, rest: string): Promise<Response> {
  const root = kernelStateRoot()

  if (rest === '/bundle' && req.method === 'GET') return json(await getKernelBundle())
  if (rest === '/anatomy' && req.method === 'GET') return json(kernelAnatomy())

  if (rest === '/comments' && req.method === 'GET') {
    const bundle = await getKernelBundle()
    return json({ schemaVersion: bundle.renderFingerprint, comments: [] })
  }

  if (rest === '/layout')
    return handleLayoutRoute(
      req,
      root,
      req.method === 'POST' ? await readJsonRecord(req) : {},
      async () => (await getKernelBundle()).renderFingerprint,
    )

  return notFound()
}
