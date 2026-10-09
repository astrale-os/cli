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
 * is fitted around everything already on the canvas, the imported frames beside the moved
 * domain included, instead of landing on top of one of them.
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
  // packed. The imported frames beside it follow it there, and the peer has to be fitted
  // around both instead of being dropped onto them.
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

/**
 * An imported frame the reader never moved is laid out beside the domain importing it, so
 * dragging that domain takes it along instead of stranding it where the domain used to be.
 */
test('the imported frames nobody moved follow a dragged domain', async ({ page, request }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()

  const canvas = page.getByTestId('workspace-schema-canvas')
  const domain = page.getByTestId(`workspace-domain-${FIXTURE_ID}`)
  const payments = page.locator('.react-flow__node-extDomain').filter({ hasText: 'payments' })
  await expect(domain).toBeVisible()
  await expect(payments).toBeVisible()

  const position = (locator: typeof domain) =>
    locator.evaluate((element) => {
      const node = element.closest('.react-flow__node') as HTMLElement
      const transform = new DOMMatrixReadOnly(node.style.transform)
      return { x: Math.round(transform.m41), y: Math.round(transform.m42) }
    })
  const offset = async () => {
    const [own, imported] = await Promise.all([position(domain), position(payments)])
    return { x: imported.x - own.x, y: imported.y - own.y }
  }

  // Grab the domain frame by its empty top-left padding once the fit has brought it on screen.
  await expect
    .poll(async () => {
      const box = await domain.boundingBox()
      const pane = await canvas.boundingBox()
      return !!box && !!pane && box.x >= pane.x && box.y >= pane.y
    })
    .toBe(true)
  const before = await position(domain)
  const relative = await offset()

  const box = (await domain.boundingBox())!
  await page.mouse.move(box.x + 8, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(box.x + 8, box.y + 128, { steps: 8 })
  await page.mouse.up()

  await expect.poll(async () => (await position(domain)).y).toBeGreaterThan(before.y)
  await expect.poll(offset).toEqual(relative)

  // And it was never written down: nothing but a drop of the frame itself records one.
  const response = await request.get('/api/workspace/state')
  const state = (await response.json()) as WorkspaceUiState
  expect(state.schema.externalPositions['payments.studio-demo.astrale.ai']).toBeUndefined()
})
