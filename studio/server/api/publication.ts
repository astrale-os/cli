/**
 * Routes of a Publication read-only (`/api/domain/@registry:<origin>@<version>/…`), as the Kernel
 * Domain's are: the reads a schema canvas makes of any Domain — bundle, anatomy, comments and
 * layout. The bundle is the one the versions service opens from the registry; when the registry
 * does not answer, the route answers its `Remote` failure with the HTTP status it stands for.
 * The arrangement is the reader's, kept on this machine, one record per origin: box ids name
 * Classes, so one arrangement serves every version. A layout write is taken only for a Publication
 * this Studio has opened, and asks the registry nothing. Every other write is refused before it
 * reaches here (`readOnlyRefusal` in `api.ts`).
 */
import { join } from 'node:path'

import type { DomainAnatomy } from '../../shared/contracts/schema'
import type { PublicationAddress, RemoteFailure } from '../../shared/contracts/versions'

import { studioHome } from '../state/home'
import { versions, type Versions } from '../workspace/versions/service'
import { json, notFound, readJsonRecord } from './http'
import { handleLayoutRoute } from './layout'

/** Machine-side state of an origin's Publications: a machine state root, written as it is. */
export function publicationStateRoot(origin: string): string {
  return join(studioHome(), 'publications', origin)
}

/** The HTTP status each registry failure stands for, so a plain HTTP reader is not told 200. */
const STATUS: Record<RemoteFailure['status'], number> = {
  'signed-out': 401,
  refused: 403,
  'not-found': 404,
  offline: 503,
  failed: 502,
}

/** What a published bundle says of a Domain's project: its origin, and nothing on disk. */
export function publishedAnatomy(origin: string): DomainAnatomy {
  return {
    overview: { origin, adapter: 'unknown', requires: [], astraleDeps: {}, schemaDir: '' },
    views: [],
    client: { shell: [], features: [], routes: {}, present: false },
    env: [],
    detectedIntegrations: [],
  }
}

export async function handlePublicationRoute(
  req: Request,
  url: URL,
  rest: string,
  { origin, version }: PublicationAddress,
  versionsOf: () => Versions = versions,
): Promise<Response> {
  const open = (fresh = false) => versionsOf().published.open(origin, version, { fresh })

  if (rest === '/bundle' && req.method === 'GET') {
    const answer = await open(url.searchParams.get('fresh') === '1')
    return answer.status === 'ok' ? json(answer.value) : json(answer, STATUS[answer.status])
  }
  if (rest === '/anatomy' && req.method === 'GET') return json(publishedAnatomy(origin))

  // A Publication is no one's to annotate: there is no thread to read or start on it.
  if (rest === '/comments' && req.method === 'GET') {
    const answer = await open()
    return json({
      schemaVersion: answer.status === 'ok' ? answer.value.renderFingerprint : '',
      comments: [],
    })
  }

  if (rest === '/layout') {
    if (req.method !== 'POST') return handleLayoutRoute(req, publicationStateRoot(origin), {})
    // a write asks the registry nothing: it arranges a Publication this Studio has opened
    const render = versionsOf().published.openedRender(origin, version)
    if (render === undefined)
      return json(
        {
          error: `This Studio has not opened ${origin} ${version}: open it before arranging it.`,
        },
        409,
      )
    return handleLayoutRoute(
      req,
      publicationStateRoot(origin),
      await readJsonRecord(req),
      async () => render,
    )
  }

  return notFound()
}
