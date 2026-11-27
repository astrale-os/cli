import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { publishedDomainId } from '../shared/contracts/versions'
import { bareOffset, drag, layoutWrite } from './arrange'
import { clearRegistry, PAYMENTS, serveRegistry, type RegistryAnswer } from './registry'
import {
  expect,
  FIXTURE_ID,
  indexRail,
  lensButton,
  PEER_ID,
  resetLayout,
  sceneBox,
  sceneCanvas,
  test,
  type Page,
} from './test'

/**
 * A Publication opens read-only at the Schema level, on the canvas and lenses of any Domain. The
 * fixture's Crm depends on Payments, which the Workspace does not hold; the stubbed registry
 * (`registry.ts`) lists three Publications of it, newest first: 1.2.0 adds a Refund Class, 1.1.0
 * is the Schema Crm is built against, 1.0.0 predates Payouts. Each holds the fixture's own
 * Classes, encoded by its SDK, so the Studio decodes and admits it as any bundle the registry
 * serves.
 */

const PUBLICATIONS: RegistryAnswer = {
  answer: 'index',
  publications: [
    { version: '1.2.0', stage: 'with-refunds', publishedAt: '2026-11-20T09:00:00.000Z' },
    { version: '1.1.0', stage: 'as-built', publishedAt: '2026-11-10T09:00:00.000Z' },
    { version: '1.0.0', stage: 'before-payouts', publishedAt: '2026-11-01T09:00:00.000Z' },
  ],
}

/** The registry failures a read can meet, each served for an origin of its own. */
const FAILING = {
  offline: 'offline.studio-demo.astrale.ai',
  refused: 'refused.studio-demo.astrale.ai',
  'not-found': 'gone.studio-demo.astrale.ai',
  failed: 'unreadable.studio-demo.astrale.ai',
} as const
/** No file serves it: the real CLI answers, signed in to nothing in this run's home. */
const UNSERVED = 'crm.studio-demo.astrale.ai'
/** Unreachable, then reachable: an origin no earlier read has left the server holding. */
const RETRIED = 'retry.studio-demo.astrale.ai'

const SERVED_ORIGINS = [PAYMENTS, RETRIED, ...Object.values(FAILING)]

test.beforeEach(async () => serveRegistry({ [PAYMENTS]: PUBLICATIONS }))
test.afterEach(async ({ request }) => clearRegistry(request, SERVED_ORIGINS))

const crumb = (page: Page) => page.getByTestId('level-domain')
const schemaLevel = (page: Page) => page.getByTestId('schema-level')
const dependencyPage = (page: Page) => page.locator('[data-workspace-page="dependency"]')

async function openPaymentsDependency(page: Page) {
  await page.goto(`/workspace?domain=${encodeURIComponent(FIXTURE_ID)}&dependency=payments`)
  await expect(dependencyPage(page)).toBeVisible()
  return dependencyPage(page).locator('[data-workspace-section="published-schema"]')
}

test('a dependency opens the Publication it is built against, and the newest, read-only', async ({
  page,
}) => {
  let published = await openPaymentsDependency(page)
  await expect(published).toContainText('Crm is built against revision')
  await expect(published).toContainText(
    `which Publication 1.1.0 carries. The newest Publication of ${PAYMENTS} is 1.2.0.`,
  )
  await published.locator('[data-open-publication="built-against"]').click()

  // the Schema level, on the Publication, marked as one in the bar
  await expect(page).toHaveURL(new RegExp(`/publication/${PAYMENTS}/1\\.1\\.0(\\?|$)`))
  await expect(schemaLevel(page)).toBeVisible()
  await expect(sceneBox(page, 'class.PaymentProcessor')).toBeVisible({ timeout: 60_000 })
  await expect(sceneBox(page, 'class.Payout')).toBeVisible()
  await expect(sceneBox(page, 'class.Refund')).toHaveCount(0)
  await expect(crumb(page)).toHaveAttribute('data-publication-crumb', `${PAYMENTS}@1.1.0`)
  await expect(crumb(page).getByTestId('read-only')).toHaveText('read-only')
  await expect(page.locator('[data-publication-notice="structure"]')).toContainText(
    `Publication ${PAYMENTS} 1.1.0, read-only.`,
  )
  // no Publish, no dataset, nothing to install from a Publication
  await expect(page.getByTestId('level-dataset')).toHaveCount(0)

  // Structure, Behavior and Rules read it; Behavior says what a published Schema cannot tell. What a lens
  // finds none of, its canvas and its Index say, instead of a blank
  for (const lens of ['behavior', 'rules', 'structure'] as const) {
    await lensButton(page, lens).click()
    await expect(schemaLevel(page)).toHaveAttribute('data-lens', lens)
    await expect(page.locator(`[data-publication-notice="${lens}"]`)).toBeVisible()
    if (lens === 'behavior') {
      await expect(sceneCanvas(page).getByTestId('scene-empty')).toHaveText(
        'The Schema declares no function: nothing here runs or changes the graph.',
      )
      await expect(sceneBox(page, 'class.PaymentProcessor')).toHaveCount(0)
      await expect(indexRail(page)).toContainText('Nothing to list.')
    } else {
      await expect(sceneBox(page, 'class.PaymentProcessor')).toBeVisible()
      await expect(sceneCanvas(page).getByTestId('scene-empty')).toHaveCount(0)
    }
    if (lens === 'rules')
      await expect(indexRail(page)).toContainText(
        'No rule is written: the Kernel’s defaults apply.',
      )
  }
  await lensButton(page, 'behavior').click()
  await expect(page.locator('[data-publication-notice="behavior"]')).toContainText(
    'a published bundle does not hold: the map draws what each declaration names, and none of its effects.',
  )
  await lensButton(page, 'structure').click()

  // its menu says what it holds, and leads back to the Domain built against it
  await crumb(page).click()
  const summary = page.locator('[data-publication-summary]')
  await expect(summary).toContainText('It declares 2 Classes (2 Node, 0 Edge)')
  await expect(summary).toContainText('Read-only')
  const dependent = page.getByRole('menuitem', { name: /crm\.studio-demo\.astrale\.ai/ })
  await expect(dependent).toContainText("as payments, on this version's Schema")
  await page.keyboard.press('Escape')

  // Back walks the places visited: the lens read before, on the same Publication
  await page.goBack()
  await expect(schemaLevel(page)).toHaveAttribute('data-lens', 'behavior')
  await expect(crumb(page)).toHaveAttribute('data-publication-crumb', `${PAYMENTS}@1.1.0`)

  // the dependency's newest version is the other Publication; the lens is the reader's, and stays
  await lensButton(page, 'structure').click()
  published = await openPaymentsDependency(page)
  await published.locator('[data-open-publication="newest"]').click()
  await expect(page).toHaveURL(new RegExp(`/publication/${PAYMENTS}/1\\.2\\.0(\\?|$)`))
  await expect(sceneBox(page, 'class.Refund')).toBeVisible({ timeout: 60_000 })
  await expect(crumb(page)).toHaveAttribute('data-publication-crumb', `${PAYMENTS}@1.2.0`)
  await crumb(page).click()
  await expect(dependent).toContainText('as payments, on another Schema revision')

  // and the bar leads to the Domain that depends on it
  await dependent.click()
  await expect(page).toHaveURL(new RegExp(`/domain/${encodeURIComponent(FIXTURE_ID)}(\\?|$)`))
  await expect(sceneBox(page, 'class.Invoice')).toBeVisible({ timeout: 60_000 })
  await expect(crumb(page)).not.toHaveAttribute('data-publication-crumb')
})

test('a Publication has an address: a reload and another browser land on it', async ({
  page,
  browser,
}) => {
  const address = `/publication/${PAYMENTS}/1.1.0?lens=rules&select=class.Payout`
  await page.goto(address)
  await expect(sceneBox(page, 'class.Payout')).toHaveAttribute('data-selected', 'true', {
    timeout: 60_000,
  })
  await expect(schemaLevel(page)).toHaveAttribute('data-lens', 'rules')
  await page.reload()
  await expect(sceneBox(page, 'class.Payout')).toHaveAttribute('data-selected', 'true', {
    timeout: 60_000,
  })
  await expect(schemaLevel(page)).toHaveAttribute('data-lens', 'rules')

  const other = await browser.newContext()
  const elsewhere = await other.newPage()
  await elsewhere.goto(page.url())
  await expect(sceneBox(elsewhere, 'class.Payout')).toHaveAttribute('data-selected', 'true', {
    timeout: 60_000,
  })
  await expect(crumb(elsewhere)).toHaveAttribute('data-publication-crumb', `${PAYMENTS}@1.1.0`)
  await other.close()

  // datasets are read from sources: the Data level of a Publication says it has none
  await page.goto(`/publication/${PAYMENTS}/1.1.0/data`)
  const none = page.locator('[data-publication-status="no-datasets"]')
  await expect(none).toContainText('carries no dataset')
  await none.getByRole('button', { name: 'Read its Schema' }).click()
  await expect(sceneBox(page, 'class.Payout')).toBeVisible()
})

/** Every file under a Domain folder, with its size and time of last change. */
async function domainFiles(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else {
        const facts = await stat(path)
        files[path.slice(root.length)] = `${facts.size}:${facts.mtimeMs}`
      }
    }
  }
  await walk(root)
  return files
}

const FIXTURE = join(import.meta.dirname, 'fixture')
const HOME = join(import.meta.dirname, '..', 'test-results', 'astrale-home')

test('a Publication writes nothing into any Domain folder: its arrangement is kept on this machine', async ({
  page,
  request,
}) => {
  const id = publishedDomainId(PAYMENTS, '1.1.0')
  await resetLayout(request, id)
  // the Workspace's own Domains are read first, so what reading them keeps is already written
  for (const domain of [FIXTURE_ID, PEER_ID])
    expect((await request.get(`/api/domain/${encodeURIComponent(domain)}/bundle`)).ok()).toBe(true)
  const before = await domainFiles(FIXTURE)

  await page.goto(`/publication/${PAYMENTS}/1.1.0`)
  await expect(sceneBox(page, 'class.Payout')).toBeVisible({ timeout: 60_000 })
  // a hand arrangement is the reader's: kept in this machine's Studio home, by origin
  const offset = await bareOffset(page, 'class.Payout')
  const written = layoutWrite(page, 'set')
  await drag(page, 'class.Payout', offset.dx, offset.dy)
  expect((await written).ok()).toBe(true)
  await expect
    .poll(() =>
      stat(join(HOME, 'studio', 'publications', PAYMENTS, 'layout.json')).then(
        (facts) => facts.size > 0,
        () => false,
      ),
    )
    .toBe(true)

  // no thread can be started on it, by hand or through the route: a target of it says so in
  // the composer's place
  await sceneCanvas(page).click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('c')
  await sceneBox(page, 'class.Payout').click()
  await expect(page.locator('[data-read-only-notice]')).toHaveText(
    'A Publication is read-only: there is no thread to start on it. Ask (A) about it instead.',
  )
  await expect(page.getByPlaceholder('Note for the agent…')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-read-only-notice]')).toHaveCount(0)
  const comment = await request.post(`/api/domain/${encodeURIComponent(id)}/comments`, {
    data: { action: 'create', body: 'Not here.' },
  })
  expect(comment.status()).toBe(403)

  await lensButton(page, 'rules').click()
  await expect(schemaLevel(page)).toHaveAttribute('data-lens', 'rules')
  expect(await domainFiles(FIXTURE)).toEqual(before)
})

test('each registry failure reads as itself, and a read again opens the Publication', async ({
  page,
}) => {
  await serveRegistry({
    [FAILING.offline]: {
      answer: 'refusal',
      code: 'CONNECTION_ERROR',
      message: 'The registry could not be reached.',
    },
    [FAILING.refused]: {
      answer: 'refusal',
      code: 'REGISTRY_ACCESS_DENIED',
      message: 'This identity may not read the Publications of this Domain.',
    },
    [FAILING['not-found']]: {
      answer: 'refusal',
      code: 'REGISTRY_DOMAIN_NOT_FOUND',
      message: 'The registry holds no such Domain.',
    },
    [FAILING.failed]: { answer: 'unreadable' },
  })
  const cases = [
    [UNSERVED, '0.0.0', 'signed-out', `Signed out: this Studio's astrale session cannot read`],
    [FAILING.offline, '1.0.0', 'offline', 'The registry could not be reached for'],
    [FAILING.refused, '1.0.0', 'refused', 'The registry refused to answer'],
    [FAILING['not-found'], '1.0.0', 'not-found', 'The registry has nothing readable for'],
    [PAYMENTS, '9.9.9', 'not-found', 'The registry has nothing readable for'],
    [FAILING.failed, '1.0.0', 'failed', 'No usable answer for'],
  ] as const
  for (const [origin, version, status, headline] of cases) {
    await page.goto(`/publication/${origin}/${version}`)
    const failure = page.locator(`[data-publication-status="${status}"]`)
    await expect(failure, `${origin} ${version}`).toBeVisible({ timeout: 60_000 })
    await expect(failure.locator(`[data-remote-status="${status}"]`)).toContainText(
      `${headline} ${origin} ${version}.`,
    )
    // the bar still names it, read-only, and the Workspace is one step away
    await expect(crumb(page)).toHaveAttribute('data-publication-crumb', `${origin}@${version}`)
    await expect(failure.getByRole('button', { name: 'Back to the Workspace' })).toBeVisible()
    await expect(sceneCanvas(page)).toHaveCount(0)
  }

  // once the registry answers, a read again opens it
  await serveRegistry({
    [RETRIED]: { answer: 'refusal', code: 'CONNECTION_ERROR', message: 'Down for now.' },
  })
  await page.goto(`/publication/${RETRIED}/1.0.0`)
  const offline = page.locator('[data-publication-status="offline"]')
  await expect(offline).toContainText('Down for now.')
  await serveRegistry({ [RETRIED]: PUBLICATIONS })
  await offline.locator('[data-workspace-retry]').click()
  await expect(sceneBox(page, 'class.PaymentProcessor')).toBeVisible({ timeout: 60_000 })
  // 1.0.0 predates Payouts
  await expect(sceneBox(page, 'class.Payout')).toHaveCount(0)
})
