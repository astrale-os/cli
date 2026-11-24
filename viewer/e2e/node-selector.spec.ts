import type { BrowserContext } from '@playwright/test'

import { classIcon, defineSchema, K, KernelSchema, nodeClass } from '@astrale-os/sdk/schema'
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { fulfillHostPage } from './host'
import { answeringKernel, introspection, type KernelAnswer } from './kernel'

/**
 * The `astrale view` node selector: a View asks for Nodes (`graph.select`), the host page fetches
 * the Finder island and its stylesheet on that first ask, shows the request under the caller's own
 * session, and answers the View with the Nodes the Shell confirms, or cancelled.
 */

const temporary = mkdtempSync(join(tmpdir(), 'astrale-view-select-'))
const childFile = join(temporary, 'child.js')
execFileSync(
  'bun',
  [
    'build',
    fileURLToPath(new URL('./select-child.ts', import.meta.url)),
    '--target=browser',
    '--format=esm',
    `--outfile=${childFile}`,
  ],
  { stdio: 'pipe' },
)
const child = readFileSync(childFile, 'utf8')

test.afterAll(() => rmSync(temporary, { recursive: true, force: true }))

const ORIGIN = 'browser-fixture.example'
const DOMAIN = 'kernel.astrale.ai:class.Domain'
const CLASS = 'kernel.astrale.ai:class.Class'
const OF_DOMAIN = 'kernel.astrale.ai:class.of_domain'
const MEMBER = `${OF_DOMAIN}.property.member`
const ABSTRACT = `${CLASS}.property.abstract`
const NAME = 'kernel.astrale.ai:class.Named.property.name'
const TOPIC = `${ORIGIN}:class.Topic`

/** The asking View's Domain: one Class, Topic, named as every Named Node is. */
const FixtureSchema = defineSchema(ORIGIN, {
  name: 'Browser fixture',
  dependencies: { kernel: KernelSchema },
  classes: {
    Topic: nodeClass({
      icon: classIcon.neutral,
      abstract: false,
      extends: [K.classes.Named],
      policies: { read: true },
    }),
  },
})
const introspected = introspection(FixtureSchema)

type Document = { list?: { nodes?: unknown[]; select?: string }; count?: unknown }

/** The Query v7 document a Kernel call carries, wherever its input holds it. */
function queryDocument(input: unknown): Document | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  if ((input as { query?: unknown }).query === 'astrale.query/7') return input as Document
  for (const value of Object.values(input)) {
    const found = queryDocument(value)
    if (found !== undefined) return found
  }
  return undefined
}

const answer = (items: unknown[], facts: unknown[]) => ({
  list: { items, complete: true },
  facts,
  revision: 'graph-revision-1',
})
const fact = (id: unknown, values: Record<string, unknown>) => ({ fact: id, values, withheld: [] })

/** The Finder's first read: the Domains the caller may read, here the asking View's own. */
const answerDomains: KernelAnswer = ({ input }) => {
  if (!JSON.stringify(input).includes(`"nodes":["${DOMAIN}"]`)) return undefined
  return answer(
    [{ fact: 'domain-1', class: DOMAIN, branches: {} }],
    [
      fact('domain-1', {
        [`${DOMAIN}.property.origin`]: ORIGIN,
        [`${DOMAIN}.property.name`]: 'Browser fixture',
      }),
    ],
  )
}

const TOPICS = [
  { id: 'topic-studio', name: 'Studio' },
  { id: 'topic-shell', name: 'Shell' },
]

/**
 * The fixture Domain as its caller reads it: one Class, Topic, and two Topics. `readable` holds the
 * Topics the caller may still read; the Shell's confirmation reads only those.
 */
function answerGraph(readable: ReadonlySet<string>): KernelAnswer {
  return (call) => {
    const known = answerDomains(call) ?? introspected(call)
    if (known !== undefined) return known
    const document = queryDocument(call.input)
    if (document === undefined) return undefined
    if (document.count !== undefined) return { count: TOPICS.length, more: false }
    const first = document.list?.nodes?.[0]
    if (typeof first === 'object' && first !== null && 'path' in first) {
      const edge = { class: OF_DOMAIN, source: 'class-topic', target: 'domain-1' }
      return {
        list: {
          items: [
            {
              fact: 'domain-1',
              class: DOMAIN,
              branches: {
                classes: {
                  items: [{ fact: 'class-topic', class: CLASS, edge, branches: {} }],
                  complete: true,
                },
              },
            },
          ],
          complete: true,
        },
        facts: [
          fact('class-topic', { [ABSTRACT]: false }),
          fact(edge, { [MEMBER]: 'class.Topic' }),
        ],
        revision: 'graph-revision-1',
      }
    }
    if (first === TOPIC) {
      return answer(
        TOPICS.map((topic) => ({ fact: topic.id, class: TOPIC, branches: {} })),
        TOPICS.map((topic) => fact(topic.id, { [NAME]: topic.name })),
      )
    }
    // By id: the preview reads values, the Shell's confirmation reads references.
    const ids = (document.list?.nodes ?? []).map((node) => (node as { id?: string }).id)
    const found = TOPICS.filter((topic) => ids.includes(topic.id) && readable.has(topic.id))
    return answer(
      found.map((topic) => ({ fact: topic.id, class: TOPIC, branches: {} })),
      document.list?.select === 'reference'
        ? []
        : found.map((topic) => fact(topic.id, { [NAME]: topic.name })),
    )
  }
}

/** The `astrale view` server for one session whose View is the fixture's child page. */
async function serveHost(
  context: BrowserContext,
  answerKernel: KernelAnswer,
): Promise<{ fetched: string[]; calls: string[] }> {
  const fetched: string[] = []
  const calls: string[] = []
  await context.route('https://**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'kernel.example') {
      return answeringKernel((call) => {
        calls.push(call.target)
        return answerKernel(call)
      })(route)
    }
    if (url.hostname === 'view.example') {
      return route.fulfill({
        contentType: url.pathname === '/child.js' ? 'application/javascript' : 'text/html',
        body:
          url.pathname === '/child.js' ? child : '<script type="module" src="/child.js"></script>',
      })
    }
    if (url.hostname !== 'host.example') return route.abort()
    fetched.push(url.pathname)
    if (url.pathname === '/config.json')
      return route.fulfill({
        json: {
          view: {
            target: `/:${ORIGIN}`,
            route: {
              key: `${ORIGIN}:view.application`,
              declaration: { target: { kind: 'domain' } },
              href: 'https://view.example/',
              handshake: 'shell',
              issuer: `https://${ORIGIN}`,
              release: `sha256:${'a'.repeat(64)}`,
              revision: `sha256:${'d'.repeat(64)}`,
            },
          },
          revision: 0,
          externalOrigins: [],
          delegationTtlSeconds: 60,
          kernelUrl: 'https://kernel.example',
          kernelIssuer: 'https://kernel.example',
          identity: 'fixture',
          instance: 'fixture',
          sessionId: 'browser-fixture',
        },
      })
    if (url.pathname === '/kernel-token')
      return route.fulfill({
        json: { token: 'kernel-fixture', expiresAt: Date.now() + 3_600_000, kind: 'minted' },
      })
    if (url.pathname === '/token')
      return route.fulfill({
        json: { token: 'browser-fixture', expiresAt: Date.now() + 240_000, kind: 'minted' },
      })
    if (url.pathname === '/status') return route.fulfill({ json: { revision: 0 } })
    return fulfillHostPage(route, url.pathname)
  })
  return { fetched, calls }
}

test('a View asks for Nodes: the island loads on the first ask and answers cancelled', async ({
  page,
  context,
}) => {
  const { fetched, calls } = await serveHost(context, answerDomains)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('https://host.example/')
  const frame = page.frameLocator('#frame iframe').first()
  await expect(frame.locator('#status')).toHaveText('ready')
  const header = page.locator('header')
  const chromeFont = await header.evaluate((element) => getComputedStyle(element).font)
  // A page whose View never asks fetches neither the island nor its stylesheet.
  expect(fetched).not.toContain('/finder.css')
  const eager = fetched.filter((path) => path.startsWith('/chunk-'))

  await frame.getByRole('button', { name: 'Select issues' }).click()
  const dialog = page.getByRole('dialog', { name: 'Link issues' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('For Browser fixture')
  await expect(dialog.getByRole('listbox', { name: 'Domains' })).toContainText('Browser fixture')
  await expect(frame.locator('#status')).toHaveText('asking')
  expect(fetched).toContain('/finder.css')
  expect(fetched.filter((path) => path.startsWith('/chunk-')).length).toBeGreaterThan(eager.length)
  // The island draws in the preset's type, its heading in the font it ships; the chrome keeps its own.
  await expect
    .poll(() => dialog.evaluate((element) => getComputedStyle(element).fontFamily))
    .toContain('Avenir Next')
  const title = dialog.getByRole('heading', { name: 'Link issues' })
  await expect
    .poll(() => title.evaluate((element) => getComputedStyle(element).fontFamily))
    .toMatch(/^"?Manrope"?,/u)
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px Manrope'))).toBe(true)
  expect(fetched.some((path) => /^\/fonts\/manrope-[a-z-]+\.woff2$/u.test(path))).toBe(true)
  expect(await header.evaluate((element) => getComputedStyle(element).font)).toBe(chromeFont)
  // Every read runs as the session's caller: the fixture refuses any other credential.
  expect(calls.length).toBeGreaterThan(0)

  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(frame.locator('#status')).toHaveText('cancelled')

  // The next ask opens a fresh selector at once; Escape cancels it.
  await frame.getByRole('button', { name: 'Select issues' }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('For Browser fixture')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(frame.locator('#status')).toHaveText('cancelled')
  expect(fetched.filter((path) => path === '/finder.css')).toHaveLength(1)
  expect(errors).toEqual([])
})

test('the caller chooses Nodes, and the View receives exactly those the Shell confirms', async ({
  page,
  context,
}) => {
  const readable = new Set(TOPICS.map((topic) => topic.id))
  await serveHost(context, answerGraph(readable))
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('https://host.example/')
  const frame = page.frameLocator('#frame iframe').first()
  await expect(frame.locator('#status')).toHaveText('ready')
  await frame.getByRole('button', { name: 'Select issues' }).click()
  const dialog = page.getByRole('dialog', { name: 'Link issues' })
  await dialog
    .getByRole('listbox', { name: 'Domains' })
    .getByRole('option', { name: /Browser fixture/u })
    .click()
  const classes = dialog.getByRole('listbox', { name: 'Classes' })
  await classes.getByRole('option', { name: /^Topic/u }).click()
  const table = dialog.getByRole('grid')
  await table.getByText('Studio').click()
  await table.getByText('Shell').click()
  await expect(dialog).toContainText('2 of 2')

  // The caller lost Shell meanwhile: the Shell refuses it, and the choice stays for another try.
  readable.delete('topic-shell')
  await dialog.getByRole('button', { name: 'Select' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Shell can no longer be selected')
  await expect(frame.locator('#status')).toHaveText('asking')

  readable.add('topic-shell')
  await dialog.getByRole('button', { name: 'Select' }).click()
  await expect(dialog).toBeHidden()
  await expect(frame.locator('#status')).toHaveText('selected Studio Shell')

  // The next ask opens where this caller left it.
  await frame.getByRole('button', { name: 'Select issues' }).click()
  await expect(classes.getByRole('option', { name: /^Topic/u })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.keyboard.press('Escape')
  await expect(frame.locator('#status')).toHaveText('cancelled')
  expect(errors).toEqual([])
})
