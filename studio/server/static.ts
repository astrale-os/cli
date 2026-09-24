/**
 * static.ts - the built SPA, served from `client/dist`.
 *
 * Vite names every asset after its content (`assets/index-<hash>.js`), so those
 * URLs are immutable and cached for good. The HTML shell is the one file a
 * rebuild rewrites in place: it is never cached, since it is what points the
 * browser at the current bundle.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Text files worth gzipping. The client ships ~1.2 MB of JavaScript and CSS, and
 * one compression per file serves every reload, every tab, and - the case that
 * actually hurts - every browser reaching the studio through a tunnel rather
 * than loopback.
 */
const COMPRESSIBLE = /\.(?:js|css|html|json|svg|map)$/u

/** One file's compression, and the version of the file it was made from. */
interface Packed {
  mtimeMs: number
  size: number
  body: ArrayBuffer
}

function acceptsGzip(req: Request): boolean {
  return (req.headers.get('accept-encoding') ?? '').toLowerCase().includes('gzip')
}

/** Serve the files of one build folder: the assets by name, the shell for every other path. */
export function staticFiles(dist: string): (pathname: string, req: Request) => Response {
  const gzipped = new Map<string, Packed>()

  function staticBody(file: string, req: Request): { body: BodyInit; encoding?: string } {
    if (!acceptsGzip(req) || !COMPRESSIBLE.test(file)) return { body: Bun.file(file) }
    try {
      const { mtimeMs, size } = statSync(file)
      let held = gzipped.get(file)
      // A compression only stands for the bytes it was made from. A rebuild while
      // the server runs rewrites the shell in place, and serving its old copy
      // would point the browser at bundles the rebuild deleted: a blank page.
      if (!held || held.mtimeMs !== mtimeMs || held.size !== size) {
        const packed = Bun.gzipSync(readFileSync(file))
        held = {
          mtimeMs,
          size,
          body: packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength),
        }
        gzipped.set(file, held)
      }
      return { body: held.body, encoding: 'gzip' }
    } catch {
      return { body: Bun.file(file) } // unreadable / already streaming fine
    }
  }

  function staticResponse(file: string, req: Request, headers: Record<string, string>): Response {
    const { body, encoding } = staticBody(file, req)
    return new Response(body, {
      headers: {
        ...headers,
        ...(encoding ? { 'content-encoding': encoding, vary: 'accept-encoding' } : {}),
      },
    })
  }

  return (pathname, req) => {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')
    const file = join(dist, rel)
    if (existsSync(file) && !file.endsWith('/') && rel !== 'index.html') {
      // Vite emits content-hashed asset names (index-<hash>.js), so a given URL is
      // immutable - cache it forever. A rebuild produces a NEW name, and the
      // never-cached shell below points the browser at it.
      return staticResponse(file, req, {
        'cache-control': 'public, max-age=31536000, immutable',
        'content-type': Bun.file(file).type,
      })
    }
    const index = join(dist, 'index.html')
    if (existsSync(index)) {
      // NEVER cache the HTML shell: it references the CURRENT hashed bundle. A stale
      // shell would point at an asset a later build deleted → 404 → the app never
      // boots and the page "loads forever". no-store guarantees every load is fresh.
      return staticResponse(index, req, {
        'content-type': 'text/html',
        'cache-control': 'no-store',
      })
    }
    return new Response(
      'client not built - run `vite build` (or set DOMAIN_STUDIO_DEV=1 for the Vite dev server)',
      { status: 500 },
    )
  }
}
