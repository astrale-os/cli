import type { WorkspaceUiState } from '@shared/types'

import { FIXTURE_ID, PEER_ID } from './test'
import { expect, test } from './test'

const PEER_ORIGIN = 'ops.studio-demo.astrale.ai'

interface Rect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * A domain the reader moved by hand stays where they put it, and a domain drawn after it
 * is fitted around everything already on the canvas — the moved domain and the imported
 * frames it left behind included — instead of landing on top of one of them.
 */
test('a domain added after another was moved by hand lands in free space', async ({
  page,
  request,
}) => {
  const readState = async () =>
    (await (await request.get('/api/workspace/state')).json()) as WorkspaceUiState

  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(page.getByTestId(`workspace-domain-${FIXTURE_ID}`)).toBeVisible()
  await expect.poll(async () => (await readState()).schema.domainPositions[FIXTURE_ID]).toBeTruthy()

  // Move the domain the way a drag would record it: a little to the left of where it was
  // packed, leaving the imported frames that were placed beside it where they are. The gap
  // that opens is too narrow for the peer, which used to be dropped right onto them.
  const state = await readState()
  const packed = state.schema.domainPositions[FIXTURE_ID]!
  const moved = { x: packed.x - 300, y: packed.y }
  await request.post('/api/workspace/state', {
    data: {
      action: 'update',
      state: {
        ...state,
        schema: {
          ...state.schema,
          visibleDomainIds: [FIXTURE_ID],
          domainPositions: { [FIXTURE_ID]: moved },
        },
      },
    },
  })
  await page.reload()

  const paintedFrames = (): Promise<Rect[]> =>
    page
      .locator('.react-flow__node-workspaceDomain, .react-flow__node-extDomain')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const el = element as HTMLElement
          const transform = new DOMMatrixReadOnly(el.style.transform)
          return {
            id: el.dataset.id ?? '',
            x: transform.m41,
            y: transform.m42,
            width: parseFloat(el.style.width),
            height: parseFloat(el.style.height),
          }
        }),
      )
  const ownId = `workspace-domain:${FIXTURE_ID}`
  const overlapping = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

  await expect(page.getByTestId(`workspace-domain-${FIXTURE_ID}`)).toBeVisible()
  const before = (await paintedFrames()).find((frame) => frame.id === ownId)!

  const rail = page.getByTestId('workspace-domain-tree')
  await rail
    .locator(`[data-anchor-ref="domain.${PEER_ORIGIN}"]`)
    .getByRole('button', { name: `Show ${PEER_ORIGIN} on the canvas` })
    .click()
  await expect(page.getByTestId(`workspace-domain-${PEER_ID}`)).toBeVisible()

  const frames = await paintedFrames()
  const own = frames.find((frame) => frame.id === ownId)!
  expect({ x: own.x, y: own.y }).toEqual({ x: before.x, y: before.y })

  const peer = frames.find((frame) => frame.id === `workspace-domain:${PEER_ID}`)!
  for (const other of frames) {
    if (other === peer) continue
    expect(overlapping(peer, other), `${PEER_ID} overlaps ${other.id}`).toBe(false)
  }
})
