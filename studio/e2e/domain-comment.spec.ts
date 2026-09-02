import { dockWorkspacePanel, expect, test, type Page } from './test'

/**
 * Commenting on a DOMAIN.
 *
 * Every other scope in the hierarchy was targetable — a class, a relationship, a module, a
 * view, the canvas itself — but a domain was not: neither the frame that draws it nor its
 * row in the rail carried an anchor, so a click on either fell through to the generic
 * canvas background. And because neither lit up under the pointer, there was nothing to say
 * the click had missed.
 *
 * The two surfaces are checked on DIFFERENT domains on purpose. The rail lists domains the
 * canvas may not be drawing, so its rows carry no `data-domain-id` for the resolver to read —
 * the owner rides on the anchor itself, and getting that wrong files the thread under
 * another domain inferred from unrelated UI state.
 */

const ACTIVE = { origin: 'crm.studio-demo.astrale.ai', id: 'fixture' }
const PEER = { origin: 'ops.studio-demo.astrale.ai', id: 'peer' }

/** Enter comment mode and point at something, reporting what would be pinned. */
async function pointAt(page: Page, x: number, y: number): Promise<string | null> {
  await page.keyboard.press('c')
  await expect(page.getByText('Comment mode — choose a domain element')).toBeVisible()
  await page.mouse.move(x, y)
  return page.evaluate(
    () => document.querySelector('[data-comment-target]')?.getAttribute('data-anchor-ref') ?? null,
  )
}

/** Finish the comment the pointer opened, and report what the server was actually told. */
async function submit(page: Page, text: string) {
  const composer = page.getByPlaceholder('Note for the agent…')
  await expect(composer).toBeVisible()
  await composer.fill(text)
  const posted = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/comments'),
  )
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  const request = await posted
  return {
    domainId: new URL(request.url()).pathname.split('/')[3],
    anchorRefs: (JSON.parse(request.postData() ?? '{}') as { anchorRefs?: unknown }).anchorRefs,
  }
}

test('a domain takes a comment, from its frame and from its rail row, in its own threads', async ({
  page,
  request,
}) => {
  await dockWorkspacePanel(request, 'left')
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(page.getByTestId('workspace-schema-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Collapse the panel' }).click()

  // ── the frame on the canvas ──
  // Aimed at the frame's own band, clear of the modules it holds: zoomed out, the padding
  // that band is made of is only a few pixels wide.
  const frame = (await page.getByTestId(`workspace-domain-${ACTIVE.id}`).boundingBox())!
  expect(await pointAt(page, frame.x + 6, frame.y + frame.height / 2)).toBe(
    `domain.${ACTIVE.origin}`,
  )
  await page.mouse.click(frame.x + 6, frame.y + frame.height / 2)
  expect(await submit(page, 'the domain as a whole')).toEqual({
    domainId: ACTIVE.id,
    anchorRefs: [{ ref: `domain.${ACTIVE.origin}`, kind: 'section' }],
  })

  // The thread is now readable from the rail row that names the same domain — the pin only
  // renders once a thread exists, so its presence IS the round trip.
  const activeRow = page
    .getByTestId('workspace-domain-tree')
    .locator(`[data-anchor-ref="domain.${ACTIVE.origin}"]`)
  await expect(activeRow.getByRole('button', { name: /comment/i })).toBeVisible()

  // ── the rail row of another domain ──
  await page.getByRole('button', { name: `Show ${PEER.origin} on the canvas` }).click()
  const peerRow = page
    .getByTestId('workspace-domain-tree')
    .locator(`[data-anchor-ref="domain.${PEER.origin}"]`)
  await expect(peerRow).toBeVisible()
  await peerRow.scrollIntoViewIfNeeded()
  const row = (await peerRow.boundingBox())!
  expect(await pointAt(page, row.x + 40, row.y + row.height / 2)).toBe(`domain.${PEER.origin}`)
  await page.mouse.click(row.x + 40, row.y + row.height / 2)
  // filed under the domain the ROW names, not under another visible domain
  expect(await submit(page, 'a note on the imported domain')).toEqual({
    domainId: PEER.id,
    anchorRefs: [{ ref: `domain.${PEER.origin}`, kind: 'section' }],
  })

  // ── and the thread navigates back to it ──
  // Park the canvas far from the frame first: opening a thread has to BRING it back, which
  // is the whole reason a domain ref is a reveal target and not just a label.
  // exact: the thread pins this test just created are called "Comments on domain.…" too
  await page.getByRole('button', { name: 'Comments', exact: true }).click()
  const activeFrame = page.getByTestId(`workspace-domain-${ACTIVE.id}`)
  const anchor = (await activeFrame.boundingBox())!
  await page.mouse.move(anchor.x + 20, anchor.y + 20)
  for (let step = 0; step < 14; step += 1) await page.mouse.wheel(0, -200)
  await page.waitForTimeout(400)

  const pane = (await page.getByTestId('workspace-schema-canvas').boundingBox())!
  const framed = async () => {
    const box = await activeFrame.boundingBox().catch(() => null)
    if (!box) return false
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    return cx > pane.x && cx < pane.x + pane.width && cy > pane.y && cy < pane.y + pane.height
  }
  expect(await framed()).toBe(false)

  await page.getByText('the domain as a whole').click()
  await expect.poll(framed).toBe(true)
})
