/**
 * The layout record's route: one contract wherever a record is kept — a Domain's in its
 * `.domain-studio/`, the Kernel's and the Workspace map's on this machine, since no project owns
 * them. A GET reads the record whole. A write names its lens: `set` merges positions by box id;
 * `collapse` and `open` add ids to the lens's shut modules or its folds opened by hand and remove
 * others (`add`, `remove`), so a write from another tab is never undone; `reset` forgets the
 * lens's arrangement and keeps both. A `reset` that names no lens forgets the whole record.
 * Every write answers the record as it now stands; one that does not decode is refused (400),
 * one past `LAYOUT_LIMITS` too (413), and neither changes anything.
 */
import type { JsonRecord } from '../json'

import {
  changeLensIds,
  idsOf,
  isLensId,
  positionsOf,
  readLayout,
  resetLayout,
  resetLensLayout,
  setLensPositions,
  type LayoutRefusal,
  type LensIds,
} from '../state/layout'
import { badRequest, json } from './http'

const refusal = (refused: LayoutRefusal): Response =>
  json({ error: refused.problem }, refused.tooLarge ? 413 : 400)

const answer = (stored: { readonly value: unknown } | LayoutRefusal): Response =>
  'problem' in stored ? refusal(stored) : json(stored.value)

/** What a `collapse` or `open` adds and removes: every id it does not name keeps its state. */
function idsWrite(root: string, kind: LensIds, lens: string, body: JsonRecord): Response {
  const add = idsOf(body.add ?? [], 'the ids added')
  if ('problem' in add) return refusal(add)
  const remove = idsOf(body.remove ?? [], 'the ids removed')
  if ('problem' in remove) return refusal(remove)
  if (add.value.length === 0 && remove.value.length === 0)
    return badRequest(`a ${body.action} write adds or removes ids`)
  return answer(changeLensIds(root, kind, lens, { add: add.value, remove: remove.value }))
}

export async function handleLayoutRoute(
  req: Request,
  root: string,
  body: JsonRecord,
  /** What the record is stamped with: the render the arrangement was made on, if there is one. */
  renderFingerprint: () => Promise<string | undefined> = async () => undefined,
): Promise<Response> {
  if (req.method === 'GET') return json(readLayout(root))
  if (req.method !== 'POST') return badRequest('GET or POST')
  if (body.action === 'reset' && body.lens === undefined) {
    resetLayout(root)
    return json(readLayout(root))
  }
  if (!isLensId(body.lens)) return badRequest('a layout write names its lens')
  const lens = body.lens
  if (body.action === 'set') {
    const positions = positionsOf(body.positions)
    if ('problem' in positions) return refusal(positions)
    return answer(setLensPositions(root, lens, positions.value, await renderFingerprint()))
  }
  if (body.action === 'collapse') return idsWrite(root, 'collapsed', lens, body)
  if (body.action === 'open') return idsWrite(root, 'opened', lens, body)
  if (body.action === 'reset') return json(resetLensLayout(root, lens))
  return badRequest('unknown layout action')
}
