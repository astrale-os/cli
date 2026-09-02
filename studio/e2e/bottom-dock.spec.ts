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
import type { AgentRun } from '@shared/types'

import { expect, test } from '@playwright/test'

/** Anything taller than this is a panel, not a bar. */
const BAR_CEILING = 120
/** A bar carrying one line of controls and nothing else. */
const ONE_LINE = 60
/** The one chat the stubbed server has. */
const CHAT_ID = 'chat-live'

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

/**
 * Answer the conversation endpoints as a server with a working harness does.
 *
 * This fixture has no harness at all, which leaves three dock states out of
 * reach: a composer you can type in, a turn in flight, and a turn to read back.
 * All are stubbed at the boundary the client actually reads — the snapshot GET,
 * whose `available` and `run` are what every other piece of the panel derives
 * its state from, and the history GET, which is where the transcript comes from.
 */
async function stubAgent(
  page: Page,
  { running = false, history = [] as AgentRun[] } = {},
): Promise<void> {
  const chatId = CHAT_ID
  const startedAt = new Date(Date.now() - 92_000).toISOString()
  const run = running
    ? {
        id: 'run-live',
        domainId: 'fixture',
        chatId,
        harness: 'claude',
        status: 'running',
        createdAt: startedAt,
        summary: 'Rename the Invoice class',
        targetCommentIds: [],
        events: [],
      }
    : null

  await page.route('**/api/domain/*/agent**', (route) => {
    const tail = new URL(route.request().url()).pathname.split('/agent')[1] ?? ''
    if (tail === '')
      return route.fulfill({
        json: { chatId, harness: 'claude', available: true, run, conversation: { turns: 1 } },
      })
    if (tail === '/chats')
      return route.fulfill({
        json: {
          chats: [
            {
              id: chatId,
              title: 'Rename the Invoice class',
              harness: 'claude',
              turns: 1,
              createdAt: startedAt,
              updatedAt: startedAt,
              status: running ? 'running' : 'idle',
              queued: [],
            },
          ],
          activeId: chatId,
        },
      })
    if (tail === '/history') return route.fulfill({ json: history })
    return route.continue()
  })
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
  // and the badge button goes: opened, the tab strip is the way to the threads,
  // and two controls for one move is one too many
  await expect(page.getByRole('button', { name: 'Open comments' })).toHaveCount(0)
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

test('a closed dock still says the agent is working', async ({ page }) => {
  await stubAgent(page, { running: true })
  await goBottom(page)

  // closed, this bar is the whole agent on screen — the header has no
  // "Agent working…" button while the dock is where the composer lives.
  // First read of the turn on a cold fixture: the snapshot lands behind the
  // server's first introspection, so give it more than the default budget.
  const working = page.getByTestId('dock-activity')
  await expect(working).toBeVisible({ timeout: 15_000 })
  await expect(working).toContainText('1m')
  await expect(page.getByTestId('agent-dock')).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('button', { name: 'Stop the agent' })).toBeVisible()
  // and it says all that without growing past a bar
  expect(await dockHeight(page)).toBeLessThan(ONE_LINE)

  // opened, the transcript above reports the turn in full — the bar goes back to
  // being a composer and stops repeating it
  await openDock(page)
  await expect(working).toHaveCount(0)
  await expect(page.getByTestId('agent-dock')).not.toHaveAttribute('aria-busy', 'true')
})

test('the comments tab shows threads alone, and gives the draft back on the way out', async ({
  page,
}) => {
  // a harness, so the field is one you can actually type in
  await stubAgent(page)
  await goBottom(page)
  // the upload below queues behind the server's first introspection
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await openDock(page)

  await composer(page).fill('half a sentence')
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Attach a document' }).click(),
  ])
  await chooser.setFiles({
    name: 'notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Notes\n'),
  })
  const chip = page.getByRole('button', { name: 'Remove notes.md' })
  await expect(chip).toBeVisible()

  // the threads are a reading surface: nothing to write with, nothing attached
  await dock(page).getByRole('button', { name: 'Comments', exact: true }).click()
  await expect(composer(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Attach a document' })).toHaveCount(0)
  await expect(chip).toHaveCount(0)

  // and the message was only ever put down, never dropped
  await dock(page).getByRole('button', { name: 'Agent', exact: true }).click()
  await expect(composer(page)).toHaveValue('half a sentence')
  await expect(chip).toBeVisible()

  await chip.click()
  await expect(chip).toHaveCount(0)
})

test('the dock stops at the window, and keeps its tab strip inside', async ({ page }) => {
  // a harness, so there is a field to overfill
  await stubAgent(page)
  await goBottom(page)
  await openDock(page)

  // a message long enough that the conversation, the composer and the header
  // together want more room than the window has
  await composer(page).fill(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'))

  const tabs = dock(page).getByRole('button', { name: 'Comments', exact: true })
  const viewport = page.viewportSize()!
  // Read both rectangles in one browser frame: filling the auto-growing textarea
  // moves the dock upward, so two protocol round-trips can otherwise compare the
  // dock's old position with the tab's new one.
  const bounds = await tabs.evaluate((tab) => {
    const dock = tab.closest('[data-testid="agent-dock"]')
    if (!(dock instanceof HTMLElement)) throw new Error('agent dock not found')
    const box = dock.getBoundingClientRect()
    const tabsBox = tab.getBoundingClientRect()
    return { boxTop: box.top, boxBottom: box.bottom, tabsTop: tabsBox.top }
  })

  // it grows upward, so this is what stops it climbing over the app header
  expect(bounds.boxTop).toBeGreaterThanOrEqual(0)
  expect(bounds.boxBottom).toBeLessThanOrEqual(viewport.height)
  // and the strip is INSIDE the dock, not scrolled off the top of it — the tab
  // strip's own scrollIntoView will drag a hidden-overflow box if it is allowed to
  expect(bounds.tabsTop).toBeGreaterThanOrEqual(bounds.boxTop)
  await expect(tabs).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Close the chat' })).toBeInViewport()
})

/**
 * A finished turn whose answer is far taller than the dock: sixty paragraphs,
 * each long enough to wrap, is several screens of prose in a box under 500px.
 */
function longTurn(paragraphs: number): AgentRun {
  const at = new Date(Date.now() - 600_000).toISOString()
  const text = Array.from(
    { length: paragraphs },
    (_, i) =>
      `Paragraph ${i + 1} of ${paragraphs}: a sentence long enough to wrap onto a second line inside the dock, so that the answer as a whole runs well past the box it is read in.`,
  ).join('\n\n')
  return {
    id: 'run-long',
    domainId: 'fixture',
    chatId: CHAT_ID,
    harness: 'claude',
    status: 'succeeded',
    createdAt: at,
    finishedAt: at,
    summary: 'Explain the model',
    instruction: 'Explain the model',
    targetCommentIds: [],
    events: [{ id: 'message-1', ts: at, kind: 'message', text }],
  }
}

/** Opening is a height transition, and the box going solid behind it another —
 *  measure only once nothing on the dock still moves. */
async function settled(page: Page): Promise<void> {
  await expect
    .poll(() => dock(page).evaluate((el) => el.getAnimations({ subtree: true }).length))
    .toBe(0)
}

/**
 * A long answer has to scroll INSIDE the dock.
 *
 * The conversation is a box of fixed height with its overflow clipped — clipped so
 * the tab strip's scrollIntoView cannot drag it — and the transcript in it only
 * scrolls if the box hands it a height. Left to grow to its content it did: the
 * clip took everything past the box, and the end of every long answer was simply
 * gone — no scrollbar, and no way to read it.
 */
test('a long answer scrolls inside the dock instead of running off its bottom', async ({
  page,
}) => {
  const paragraphs = 60
  await stubAgent(page, { history: [longTurn(paragraphs)] })
  await goBottom(page)
  await openDock(page)
  await settled(page)

  const transcript = dock(page).locator('[data-radix-scroll-area-viewport]')
  const end = dock(page).getByText(`Paragraph ${paragraphs} of ${paragraphs}`)
  await expect(end).toBeAttached()

  // the transcript is what scrolls: taller inside than out
  await expect
    .poll(() => transcript.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(0)

  // and scrolled to the end, the end of the answer is on screen — inside the
  // transcript, which itself stops above the field
  await transcript.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  const edges = await end.evaluate((paragraph) => {
    const box = paragraph.closest('[data-testid="agent-dock"]')
    const viewport = paragraph.closest('[data-radix-scroll-area-viewport]')
    const field = box?.querySelector('[data-agent-composer]')
    if (!box || !viewport || !field) throw new Error('dock, transcript or field not found')
    return {
      end: paragraph.getBoundingClientRect().bottom,
      transcript: viewport.getBoundingClientRect().bottom,
      field: field.getBoundingClientRect().top,
    }
  })
  expect(edges.end).toBeLessThanOrEqual(edges.transcript)
  expect(edges.transcript).toBeLessThanOrEqual(edges.field)
  await expect(end).toBeInViewport()
})
