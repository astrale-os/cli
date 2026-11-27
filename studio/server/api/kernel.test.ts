import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StudioSchemaBundle } from '../../shared/contracts/schema'

import { KERNEL_DOMAIN_ID, KERNEL_ORIGIN } from '../../shared/contracts/workspace'
import { handleApi } from '../api'
import { invalidateKernel } from '../introspect/kernel'

const home = process.env.ASTRALE_HOME
const homes: string[] = []
afterEach(() => {
  if (home === undefined) delete process.env.ASTRALE_HOME
  else process.env.ASTRALE_HOME = home
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true })
})

function machineHome(): void {
  const root = mkdtempSync(join(tmpdir(), 'studio-kernel-home-'))
  homes.push(root)
  process.env.ASTRALE_HOME = root
}

const kernelUrl = (rest: string) =>
  `http://127.0.0.1/api/domain/${encodeURIComponent(KERNEL_DOMAIN_ID)}${rest}`

async function call(rest: string, init?: RequestInit): Promise<Response> {
  const url = kernelUrl(rest)
  const response = await handleApi(new Request(url, init), new URL(url), () => {})
  if (!response) throw new Error(`no route for ${rest}`)
  return response
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('the Kernel bundle is the Kernel Schema the installed SDK ships, admitted', async () => {
  invalidateKernel()
  const response = await call('/bundle')
  expect(response.status).toBe(200)
  const bundle = (await response.json()) as StudioSchemaBundle
  expect(bundle.domainId).toBe(KERNEL_DOMAIN_ID)
  expect(bundle.schemaMode).toBe('canonical-admitted')
  expect(bundle.error).toBeNull()
  expect(bundle.ir?.domain).toBe(KERNEL_ORIGIN)
  expect(bundle.ir?.classes.Identity?.type).toBe('node')
  expect(Object.keys(bundle.ir?.classes.Identity?.methods ?? {})).toContain('whoami')
  expect(Object.keys(bundle.ir?.functions ?? {})).toContain('mutate')
}, 60_000)

test('the Kernel is read-only: no threads, no writes beyond reader preferences', async () => {
  machineHome()
  expect(await (await call('/comments')).json()).toMatchObject({ comments: [] })
  const refused = await call('/comments', post({ action: 'create', text: 'hello' }))
  expect(refused.status).toBe(403)
  expect((await call('/anatomy')).status).toBe(200)

  // Its layout is this machine's way of reading the Kernel, kept off any project, and read
  // through the same lenses as a Domain's: each keeps its own, a reset forgets one.
  const place = (lens: string, x: number) =>
    call('/layout', post({ action: 'set', lens, positions: { 'class.Identity': { x, y: 2 } } }))
  await place('structure', 4)
  await place('behavior', 9)
  await call('/layout', post({ action: 'collapse', lens: 'structure', add: ['module.auth'] }))
  expect(await (await call('/layout')).json()).toMatchObject({
    lenses: {
      structure: { 'class.Identity': { x: 4, y: 2 } },
      behavior: { 'class.Identity': { x: 9, y: 2 } },
    },
    collapsed: { structure: ['module.auth'] },
  })
  await call('/layout', post({ action: 'reset', lens: 'structure' }))
  expect((await (await call('/layout')).json()).lenses).toEqual({
    behavior: { 'class.Identity': { x: 9, y: 2 } },
  })
  expect((await call('/visibility')).status).toBe(404)
}, 60_000)
