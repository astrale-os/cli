import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { staticFiles } from './static'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

/** A build folder the way Vite leaves one: a shell pointing at one hashed bundle. */
function build(hash: string, dist?: string): string {
  const root = dist ?? mkdtempSync(join(tmpdir(), 'studio-static-'))
  if (!dist) roots.push(root)
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'assets', `index-${hash}.js`), `console.log('${hash}')`)
  writeFileSync(
    join(root, 'index.html'),
    `<!doctype html><script type="module" src="/assets/index-${hash}.js"></script>`,
  )
  return root
}

const browser = (path: string) =>
  new Request(`http://127.0.0.1${path}`, { headers: { 'accept-encoding': 'gzip, br' } })

async function read(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  return new TextDecoder().decode(
    response.headers.get('content-encoding') === 'gzip' ? Bun.gunzipSync(bytes) : bytes,
  )
}

test('a rebuild while the server runs reaches the browser, shell and all', async () => {
  const dist = build('AAAAAAAA')
  const serve = staticFiles(dist)

  const first = serve('/', browser('/'))
  expect(first.headers.get('content-encoding')).toBe('gzip')
  expect(first.headers.get('cache-control')).toBe('no-store')
  expect(await read(first)).toContain('/assets/index-AAAAAAAA.js')

  // the rebuild rewrites the shell in place, same length, and moves the bundle
  rmSync(join(dist, 'assets'), { recursive: true })
  build('BBBBBBBB', dist)
  const later = new Date(Date.now() + 5_000)
  utimesSync(join(dist, 'index.html'), later, later)

  const next = serve('/', browser('/'))
  expect(await read(next)).toContain('/assets/index-BBBBBBBB.js')
  // and the bundle it names is there, cached for good under its new name
  const bundle = serve('/assets/index-BBBBBBBB.js', browser('/assets/index-BBBBBBBB.js'))
  expect(bundle.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  expect(await read(bundle)).toBe("console.log('BBBBBBBB')")
})

test('a path that names no file is the shell; a client that takes no gzip gets it plain', async () => {
  const serve = staticFiles(build('CCCCCCCC'))

  const deep = serve('/workspace/schema', browser('/workspace/schema'))
  expect(deep.headers.get('content-type')).toBe('text/html')
  expect(await read(deep)).toContain('/assets/index-CCCCCCCC.js')

  const plain = serve('/', new Request('http://127.0.0.1/'))
  expect(plain.headers.get('content-encoding')).toBeNull()
  expect(await read(plain)).toContain('/assets/index-CCCCCCCC.js')
})

test('without a build it says how to make one', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'studio-static-empty-'))
  roots.push(empty)

  const response = staticFiles(empty)('/', browser('/'))
  expect(response.status).toBe(500)
  expect(await response.text()).toContain('vite build')
})
