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
import type { AgentRun } from '@shared/types'

import { FIXTURE_ID } from './test'
import { expect, test, type Page } from './test'

/** Anything taller than this is a panel, not a bar. */
const BAR_CEILING = 120
/** A bar carrying one line of controls and nothing else. */
const ONE_LINE = 60
/** The one chat the stubbed server has. */
const CHAT_ID = 'chat-live'
/** The fixture domain, as the paperclip's list names it. */
const FIXTURE_ORIGIN = 'crm.studio-demo.astrale.ai'

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
        chatId,
        harness: 'claude',
        status: 'running',
        createdAt: startedAt,
        summary: 'Rename the Invoice class',
        targetCommentIds: [],
        events: [],
      }
    : null

  await page.route('**/api/agent**', (route) => {
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
  // one clip: an image comes in by pasting or dropping it, not by a second button
  await expect(page.getByRole('button', { name: 'Add an image' })).toHaveCount(0)
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

test('a long draft rests as its first words on one line, and opens across the whole dock', async ({
  page,
}) => {
  await stubAgent(page)
  await goBottom(page)
  const draft =
    'Several roles per person and per entity, since there are several modules\nAccounts with no profile: reset the data\nSend it on creation: yes'

  await openDock(page)
  await composer(page).fill(draft)
  // open, the field runs from edge to edge; the controls wait on the row below it
  const open = (await dock(page).boundingBox())!
  const field = (await composer(page).boundingBox())!
  expect(field.width).toBeGreaterThan(open.width - 40)

  await page.keyboard.press('Escape')
  await expect.poll(() => dockHeight(page)).toBeLessThan(ONE_LINE)
  // resting: the opening words, on one line, newlines flattened
  await expect(dock(page).locator('[data-draft-preview]')).toHaveText(draft.replace(/\n/g, ' '))
  expect(await composer(page).inputValue()).toBe(draft)

  // and a press on it gives the whole draft back, caret in the field
  await openDock(page)
  await expect(composer(page)).toBeFocused()
  await expect(composer(page)).toHaveValue(draft)
})

test('the paperclip chooses a domain, then shows what it took', async ({ page }) => {
  await goBottom(page)
  // an upload queues behind the server's first introspection, and a cold fixture
  // spends most of the test budget on it — let the canvas say that is done
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 })
  // Opened, because the chip this test is about only exists in the opened chat —
  // the resting bar is one line and shows no payload. Left to the disabled field
  // to open it, the assertion below would be testing that instead.
  await openDock(page)

  // A multi-domain workspace has no implicit attachment owner. The paperclip asks once,
  // then the chosen domain's row opens the native picker - with no second clip on it.
  await page.getByRole('button', { name: 'Attach a document to a domain' }).click()
  await expect(page.getByText('Attach to domain')).toBeVisible()
  await expect(page.getByRole('dialog').locator('svg.lucide-paperclip')).toHaveCount(0)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: `Attach a document to ${FIXTURE_ORIGIN}` }).click(),
  ])

  await chooser.setFiles({
    name: 'notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Notes\n'),
  })
  await expect(page.getByText('Attach to domain')).toHaveCount(0)
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

test('opening grows the dock upward from the bar it rests as', async ({ page }) => {
  await goBottom(page)
  const before = (await composer(page).boundingBox())!
  const bar = (await dock(page).boundingBox())!

  await openDock(page)
  const opened = (await dock(page).boundingBox())!
  // the whole point of growing rather than opening a panel: the bar's foot stays
  // put and everything unfolds above it. The field itself rises by one row — open,
  // it spans the whole width and the controls sit under it
  expect(Math.round(opened.y + opened.height)).toBe(Math.round(bar.y + bar.height))
  const after = (await composer(page).boundingBox())!
  expect(after.width).toBeGreaterThan(before.width)
  await expect(dock(page).getByRole('button', { name: 'Comments', exact: true })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect.poll(() => dockHeight(page)).toBeLessThan(BAR_CEILING)
  expect(Math.round((await composer(page).boundingBox())!.y)).toBe(Math.round(before.y))
})

/**
 * The open dock resizes from its edges: the top edge sets the conversation's
 * height, a side edge the dock's width on both sides at once, so it never leaves
 * the middle of the view. The field under the caret stays where it was.
 */
test('the open dock resizes from its edges and stays centred', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await goBottom(page)
  await openDock(page)
  const box = async () => (await dock(page).boundingBox())!
  const centre = (rect: { x: number; width: number }) => Math.round(rect.x + rect.width / 2)
  const before = await box()
  const field = (await composer(page).boundingBox())!

  // wider, from the right edge: both sides move, the centre does not
  const right = (await dock(page).locator('[data-dock-resize="right"]').boundingBox())!
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2)
  await page.mouse.down()
  await page.mouse.move(right.x + right.width / 2 + 100, right.y + right.height / 2, { steps: 4 })
  await page.mouse.up()
  const wider = await box()
  expect(Math.round(wider.width)).toBe(Math.round(before.width) + 200)
  expect(Math.abs(centre(wider) - centre(before))).toBeLessThanOrEqual(1)

  // narrower, from the left edge: same rule
  const left = (await dock(page).locator('[data-dock-resize="left"]').boundingBox())!
  await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2)
  await page.mouse.down()
  await page.mouse.move(left.x + left.width / 2 + 150, left.y + left.height / 2, { steps: 4 })
  await page.mouse.up()
  const narrower = await box()
  expect(Math.round(narrower.width)).toBe(Math.round(wider.width) - 300)
  expect(Math.abs(centre(narrower) - centre(before))).toBeLessThanOrEqual(1)

  // taller, from the top edge: the dock grows upward and the field stays put
  const top = (await dock(page).locator('[data-dock-resize="top"]').boundingBox())!
  await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2)
  await page.mouse.down()
  await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2 - 120, { steps: 4 })
  await page.mouse.up()
  const taller = await box()
  expect(Math.round(taller.height)).toBe(Math.round(narrower.height) + 120)
  expect(Math.round((await composer(page).boundingBox())!.y)).toBe(Math.round(field.y))

  // and never past the view: a drag far beyond the top stops at the window
  const top2 = (await dock(page).locator('[data-dock-resize="top"]').boundingBox())!
  await page.mouse.move(top2.x + top2.width / 2, top2.y + top2.height / 2)
  await page.mouse.down()
  await page.mouse.move(top2.x + top2.width / 2, -400, { steps: 4 })
  await page.mouse.up()
  const tallest = await box()
  const main = (await page.locator('main').boundingBox())!
  expect(tallest.y).toBeGreaterThanOrEqual(main.y)

  // the size is the dock's own: it survives closing and reopening
  await page.keyboard.press('Escape')
  await expect.poll(() => dockHeight(page)).toBeLessThan(BAR_CEILING)
  expect(Math.round((await box()).width)).toBe(Math.round(narrower.width))
  await openDock(page)
  await expect.poll(async () => Math.round((await box()).height)).toBe(Math.round(tallest.height))

  // a double click on an edge puts the default back
  await dock(page).locator('[data-dock-resize="left"]').dblclick()
  await expect.poll(async () => Math.round((await box()).width)).toBe(Math.round(before.width))
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
 * Open threads are signalled on the composer, not sent: one chip counts them, and
 * a message only carries the threads picked from it. Naming each thread on the
 * composer itself would put the comments tab's job on a line that has to stay one
 * line — so the chip opens a picker, and the picker leads to the comments tab.
 */
test('open threads are signalled on the composer and attached only when picked', async ({
  page,
  request,
}) => {
  const workspace = (await (await request.get('/api/workspace')).json()) as Array<{ id: string }>
  const domainId = workspace.find((domain) => domain.id === FIXTURE_ID)!.id
  const url = `/api/domain/${encodeURIComponent(domainId)}/comments`
  const made: string[] = []
  for (const text of ['Rename this class', 'And split that module']) {
    const created = await request.post(url, {
      data: {
        action: 'create',
        anchors: ['class.Company'],
        anchorRefs: [{ ref: 'class.Company', kind: 'schema' }],
        text,
      },
    })
    expect(created.ok()).toBe(true)
    made.push(((await created.json()) as { id: string }).id)
  }

  await stubAgent(page)
  const submitted: Array<Record<string, unknown>> = []
  await page.route('**/api/agent/submit', (route) => {
    submitted.push(route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill({ json: {} })
  })
  await goBottom(page)
  await openDock(page)

  // one chip for both threads, saying they are there — none of them is attached yet
  const chip = dock(page).getByTestId('comment-picker')
  await expect(chip).toHaveText('2 open comments')
  await expect(dock(page).getByRole('button', { name: /Rename this class/ })).toHaveCount(0)

  // a plain message goes alone
  await composer(page).fill('Unrelated work')
  await composer(page).press('Enter')
  await expect.poll(() => submitted.length).toBe(1)
  expect(submitted[0]).not.toHaveProperty('comments')

  // pick one thread: the next message carries it, and only it
  await chip.click()
  await page.getByRole('menuitemcheckbox', { name: /Rename this class/ }).click()
  await expect(chip).toHaveText('1 of 2 comments attached')
  await page.keyboard.press('Escape')
  await composer(page).fill('Handle this one')
  await composer(page).press('Enter')
  await expect.poll(() => submitted.length).toBe(2)
  expect(submitted[1]).toMatchObject({ message: 'Handle this one', comments: [made[0]] })
  // the pick went with that message
  await expect(chip).toHaveText('2 open comments')

  // and the picker is the way to the threads themselves
  await chip.click()
  await page.getByRole('button', { name: 'Open the comments tab' }).click()
  const fixtureThreads = dock(page).getByTestId(`comments-domain-${FIXTURE_ID}`)
  await expect(
    fixtureThreads.getByRole('heading', { name: 'crm.studio-demo.astrale.ai' }),
  ).toBeVisible()
  await expect(fixtureThreads.getByLabel('2 open threads')).toBeVisible()
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
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await openDock(page)

  await composer(page).fill('half a sentence')
  await page.getByRole('button', { name: 'Attach a document to a domain' }).click()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: `Attach a document to ${FIXTURE_ORIGIN}` }).click(),
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
  await expect(page.getByRole('button', { name: /Attach a document/ })).toHaveCount(0)
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
