/**
 * Who may drive the Studio server: the Studio's own page, and clients that are not browsers.
 *
 * The server runs an agent that edits code, reads secret values and publishes, so a request is
 * answered only when it comes from this Studio. One rule, before every route — the API, the
 * events stream and the page's files:
 *
 * - `Host` names this server: `localhost`, `127.0.0.1` or `[::1]` at its port, the host it was
 *   bound to when that is not a wildcard, and under `--dev` the Vite dev server's. A page at
 *   another name rebound to this address (DNS rebinding) is same-origin with itself, not with
 *   the Studio, and names its own host.
 * - `Origin`, when present, is exactly `http://` one of those hosts.
 * - `Sec-Fetch-Site`, when present, is `same-origin` or `none` (an address typed or opened by
 *   the reader); under `--dev`, `same-site` from the Vite dev origin too. A `cross-site` or
 *   `same-site` request is refused on every method, reads included: a read starts registry
 *   reads and extractions, and an `<img>` on any page could start them.
 *
 * A client with neither `Origin` nor `Sec-Fetch-Site` — the CLI, curl, the agent's bridge, the
 * browser suite's request fixture — is not a browser page and passes on `Host` alone.
 */

const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]'] as const
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]', ''])

/** The hosts and origins this server answers. */
export interface Audience {
  /** `name:port`, lower-case; a bare name too when the port is 80 */
  readonly hosts: ReadonlySet<string>
  /** `http://name:port`, exactly as a browser sends it */
  readonly origins: ReadonlySet<string>
  /** the Vite dev origin under `--dev`, whose same-site requests pass */
  readonly devOrigin?: string
}

/** A host name as a `Host` header writes it: an IPv6 literal in brackets, lower-case. */
function hostName(name: string): string {
  const lower = name.trim().toLowerCase()
  return lower.includes(':') && !lower.startsWith('[') ? `[${lower}]` : lower
}

/** The audience of a server bound to `boundHost` at `port`, with a Vite dev origin under `--dev`. */
export function studioAudience(input: {
  port: number
  boundHost?: string
  devOrigin?: string
}): Audience {
  const hosts = new Set<string>()
  const origins = new Set<string>()
  const admit = (name: string, port: number) => {
    hosts.add(`${name}:${port}`)
    origins.add(`http://${name}:${port}`)
    if (port === 80) {
      hosts.add(name)
      origins.add(`http://${name}`)
    }
  }
  for (const name of LOOPBACK_NAMES) admit(name, input.port)
  const bound = hostName(input.boundHost ?? '')
  if (!WILDCARD_HOSTS.has(bound)) admit(bound, input.port)
  let devOrigin: string | undefined
  if (input.devOrigin) {
    const dev = new URL(input.devOrigin)
    devOrigin = dev.origin
    hosts.add(dev.host)
    origins.add(dev.origin)
  }
  return { hosts, origins, ...(devOrigin ? { devOrigin } : {}) }
}

const refuse = (reason: string): Response =>
  new Response(JSON.stringify({ error: `This Studio answers only its own page: ${reason}.` }), {
    status: 403,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/** Why `req` is refused, as the response to send; nothing when it may be answered. */
export function refusal(req: Request, audience: Audience): Response | undefined {
  const host = (req.headers.get('host') ?? new URL(req.url).host).toLowerCase()
  if (!audience.hosts.has(host)) return refuse(`the host ${host || '(none)'} is not this Studio's`)

  const origin = req.headers.get('origin')
  if (origin !== null && !audience.origins.has(origin))
    return refuse(`the origin ${origin} is not this Studio's`)

  const site = req.headers.get('sec-fetch-site')
  if (site === null || site === 'same-origin' || site === 'none') return undefined
  if (site === 'same-site' && audience.devOrigin !== undefined && origin === audience.devOrigin)
    return undefined
  return refuse(`a ${site} request`)
}
