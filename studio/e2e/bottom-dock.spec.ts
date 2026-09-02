/**
 * The bottom dock is the composer itself, floating over the view, with the
 * conversation growing out of it. Two things make it that rather than a third
 * panel, and both are pinned here: it takes no room from the view, and opening it
 * does not move the field you opened it from.
 *
 * The fixture has no harness, so the composer here is the DISABLED one — which is
 * exactly why the bar as a whole has to open the dock. Were it only the field,
 * this fixture could never reach the tabs or the control that docks it elsewhere.
 */
import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

/** Anything taller than this is a panel, not a bar. */
const BAR_CEILING = 120
/** A bar carrying one line of controls and nothing else. */
const ONE_LINE = 60

const dock = (page: Page) => page.getByTestId('agent-dock')
const composer = (page: Page) => page.locator('[data-agent-composer]')

async function dockHeight(page: Page): Promise<number> {
  return Math.round((await dock(page).boundingBox())!.height)
}

/**
 * Open it the way a reader does: press the field. It is DISABLED without a
 * harness, so the press lands on the bar around it — which is the whole reason
 * the bar opens the dock and not just the field.
 */
async function openDock(page: Page): Promise<void> {
  const field = (await composer(page).boundingBox())!
  await page.mouse.click(field.x + field.width / 2, field.y + field.height / 2)
  await expect.poll(() => dockHeight(page)).toBeGreaterThan(BAR_CEILING)
}

/** Just load the studio: the floating dock is where the panel starts. Nothing is
 *  clicked to get here, and the resting bar has no dock control to click anyway. */
async function goBottom(page: Page): Promise<void> {
  await page.goto('/')
  await expect(dock(page)).toBeVisible()
}

test('the bottom dock floats over the view instead of taking room from it', async ({ page }) => {
  await goBottom(page)

  // the docked column is gone, and the dock is resting at bar height
  await expect(page.getByRole('button', { name: 'Collapse the panel' })).toHaveCount(0)
  await expect(dock(page)).toBeVisible()
  expect(await dockHeight(page)).toBeLessThan(BAR_CEILING)

  // and the view runs on underneath it, all the way down
  const main = (await page.locator('main').boundingBox())!
  const bar = (await dock(page).boundingBox())!
  expect(main.y + main.height).toBeGreaterThan(bar.y + bar.height)
})

test('at rest the bar is one line and carries nothing it cannot act on', async ({ page }) => {
  await goBottom(page)
  const model = page.locator('[title*="Click to change model"]')

  expect(await dockHeight(page)).toBeLessThan(ONE_LINE)
  await expect(page.getByRole('button', { name: 'Attach a document' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open comments' })).toBeVisible()
  // nothing typed is nothing to send, and the model is a question for a chat you
  // are actually in — neither earns a place on a resting line
  await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0)
  await expect(model).toHaveCount(0)

  // opened, the bar affords the row it could not: the tab strip, and the control
  // that docks the panel elsewhere. Deliberately not the model picker — it names
  // a model or nothing, so on a machine with no agent installed (CI) there is
  // nothing for it to name, and asserting it here would pass only where an agent
  // happens to be on PATH.
  await openDock(page)
  await expect(page.getByRole('button', { name: 'Where the panel sits' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Comments', exact: true })).toBeVisible()
})

test('the paperclip goes straight to the file picker, and shows what it took', async ({ page }) => {
  await goBottom(page)
  // an upload queues behind the server's first introspection, and a cold fixture
  // spends most of the test budget on it — let the canvas say that is done
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  // Opened, because the chip this test is about only exists in the opened chat —
  // the resting bar is one line and shows no payload. Left to the disabled field
  // to open it, the assertion below would be testing that instead.
  await openDock(page)

  // one click, one meaning — no menu standing between the clip and the picker
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Attach a document' }).click(),
  ])
  await expect(page.locator('[data-radix-popper-content-wrapper]')).toHaveCount(0)

  await chooser.setFiles({
    name: 'notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Notes\n'),
  })
  // what the agent was given is on the composer, not behind anything
  const chip = page.getByRole('button', { name: 'Remove notes.md' })
  await expect(chip).toBeVisible()
  // and it is turn enough on its own — a document says "read this"
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()

  // the resting bar is one line and carries nothing: the chip belongs to the
  // opened chat, not to the bar it grew from
  await page.keyboard.press('Escape')
  await expect.poll(() => dockHeight(page)).toBeLessThan(ONE_LINE)
  await expect(chip).toHaveCount(0)
  await openDock(page)
  await expect(chip).toBeVisible()

  await chip.click()
  await expect(chip).toHaveCount(0)
})

test('opening grows the dock upward without moving the field it grew from', async ({ page }) => {
  await goBottom(page)
  const before = (await composer(page).boundingBox())!

  await openDock(page)
  const after = (await composer(page).boundingBox())!
  // the whole point of growing rather than opening a panel: the field stays put
  expect(Math.round(after.y)).toBe(Math.round(before.y))
  await expect(dock(page).getByRole('button', { name: 'Comments', exact: true })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect.poll(() => dockHeight(page)).toBeLessThan(BAR_CEILING)
  expect(Math.round((await composer(page).boundingBox())!.y)).toBe(Math.round(before.y))
})

test('a click beside the dock puts it away', async ({ page }) => {
  await goBottom(page)
  await openDock(page)

  // the view's own top-left, well clear of the dock
  await page.mouse.click(40, 200)
  await expect.poll(() => dockHeight(page)).toBeLessThan(BAR_CEILING)
})

test('re-docking to a side leaves the floating dock behind', async ({ page }) => {
  await goBottom(page)
  await openDock(page)

  await dock(page).getByRole('button', { name: 'Where the panel sits' }).click()
  await page.getByRole('button', { name: 'Right' }).click()

  await expect(dock(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Collapse the panel' })).toBeVisible()
})

/**
 * What the turn carries in threads is a COUNT, and the count is a door.
 *
 * Naming each thread on the composer put the comments tab's job on a line that has
 * to stay one line — and said it in a place you cannot answer from. One chip says
 * how much is coming, and clicking it goes where you can read it.
 */
test('the threads on the composer are one chip that counts them, and opens them', async ({
  page,
  request,
}) => {
  const workspace = (await (await request.get('/api/workspace')).json()) as Array<{ id: string }>
  const domainId = workspace.find((domain) => domain.id === 'fixture')!.id
  const url = `/api/domain/${encodeURIComponent(domainId)}/comments`
  const made: string[] = []
  for (const text of ['Rename this class', 'And split that module']) {
    const created = await request.post(url, {
      data: { action: 'create', anchors: ['class.Company'], anchorRefs: [], text },
    })
    expect(created.ok()).toBe(true)
    made.push(((await created.json()) as { id: string }).id)
  }

  await goBottom(page)
  await openDock(page)

  // one chip for both threads, and it says how many — not what they are pinned on
  const chip = dock(page).getByRole('button', { name: '2 comments' })
  await expect(chip).toBeVisible()
  await expect(dock(page).getByRole('button', { name: /Rename this class/ })).toHaveCount(0)

  await chip.click()
  await expect(dock(page).getByText('Rename this class')).toBeVisible()
  await expect(dock(page).getByText('And split that module')).toBeVisible()

  for (const id of made) {
    expect((await request.post(url, { data: { action: 'delete', id } })).ok()).toBe(true)
  }
})
