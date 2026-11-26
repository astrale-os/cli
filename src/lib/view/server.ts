import type { Credentials, SessionCredential } from '@astrale-os/sdk/client/session'
import type { ResolvedView } from '@astrale-os/shell'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

import { issuer as issuerId } from '@astrale-os/sdk/auth'
import { credentials } from '@astrale-os/sdk/client/session'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isDeepStrictEqual } from 'node:util'

import type { ViewServeConfig, ViewSessionRecord } from './session'

import { withClientSession } from '../../connection'
import { AstraleError, InternalError } from '../../errors'
import { fetchWithCaFile } from '../ca-fetch'
import { viewerDistDir } from './assets'
import { exchangeViewCredential } from './exchange-credential'
import { exchangedIssuer, type GrantKind, mintedExpiry, type TokenGrant } from './grant'
import { createOwnerAccess, ROOT_IDENTITY, type OwnerAccess, type ViewIdentity } from './owner'
import { refreshViewPlacement } from './refresh'
import { removeSessionFiles, saveRecord } from './session'
import { viewerFileContentType } from './viewer-files'

/**
 * The view-session server: serves the host page, hands it config and fresh
 * credentials, receives its lifecycle reports, and proxies the view's kernel
 * calls (one mechanism for CORS, self-signed local CAs, and keeping the kernel
 * origin out of the page). Everything is nonce-scoped under `/s/<nonce>/`;
 * loopback-only.
 *
 * A session belongs to the pages attached to it, never to whoever opened it.
 * Each page announces itself on every heartbeat and says goodbye when it goes,
 * so a host that is done with a session (Studio closing its dialog) releases it
 * rather than killing it: the server then shuts down once the last page has
 * left, and a View the operator opened in its own tab outlives the dialog it
 * came from. `idleMs` remains the net under that rule, for a page that stopped
 * reporting without ever leaving.
 *
 * Whose authority the View runs on is the session's: a local CLI identity, among
 * those the operator allowed, or - in owner mode (`./owner`) - the instance root
 * Admin issues to its owner, or an Identity impersonated from it. Either way the
 * page only receives grants derived from that authority, never the authority.
 *
 * A Domain's issuer changes with each release, so a View's credential is issued for the release
 * its window runs, which the page names on each request: a window the Shell moves to the release
 * the Kernel serves now receives that release's credential, and never another's.
 */

const VIEW_TOKEN_TTL_SECONDS = 4 * 60
/**
 * Delegation the mounted View must always be able to make from its bearer. This server renews a
 * grant once it stops covering that delegation, and the host page anticipates its own Kernel
 * credential against the same value from `/config.json`.
 */
const VIEW_DELEGATION_TTL_SECONDS = 60
const IDLE_SWEEP_MS = 60_000
/**
 * Grace between the last page leaving a released session and the shutdown. A
 * reload leaves and comes back within a fraction of this on loopback; anything
 * that has not come back by then is not coming back.
 */
const RELEASE_GRACE_MS = 10_000
/**
 * Reserved to the loopback host page and the host that opened the session.
 * Reading the View's identity and release, listing the identities it may run as,
 * minting against it, changing it and ending the session are the host's, never
 * the embedded View's, whether or not this session was opened with identities to
 * switch between.
 */
const HOST_ONLY_ROUTES = [
  '/config.json',
  '/identities',
  '/identity',
  '/release',
  '/current',
  '/token',
  '/kernel-token',
]
/** Host-only reads a page makes before it knows, or regardless of, the revision in force. */
const REVISION_FREE_ROUTES = ['/config.json', '/identities', '/release']

type PageStatus = { state: string; error?: string; at: string }

/** What a grant provider holds: the kind of its grant, and its expiry, infinite while it mints. */
interface HeldGrant {
  kind: GrantKind
  expiresAt: number
}

/**
 * The grants of one audience: a View's Domain issuer, for a credential exchanged for the caller, or
 * the Kernel's, for one minted. Kept while it mints or holds a grant that has not expired.
 */
interface AudienceGrants extends HeldGrant {
  readonly credentials: Credentials
}

interface ViewServerDependencies {
  readonly connect: typeof withClientSession
  readonly exchange?: typeof exchangeViewCredential
  /** Owner-mode authority over the instance; production derives it from Admin. */
  readonly owner?: (
    config: NonNullable<ViewServeConfig['owner']>,
    kernel: ViewServeConfig['proxy'],
  ) => OwnerAccess
  readonly persist?: typeof saveRecord
  /** Seam for the tests: the shutdown path ends the process in production. */
  readonly exit?: (code: number) => void
}

const DEFAULT_DEPENDENCIES: ViewServerDependencies = Object.freeze({
  connect: withClientSession,
})

/** Owner access to exactly the Kernel this session proxies. */
function ownerAccess(
  owner: NonNullable<ViewServeConfig['owner']>,
  proxy: ViewServeConfig['proxy'],
): OwnerAccess {
  return createOwnerAccess(owner, {
    url: proxy.kernelUrl,
    issuer: proxy.issuer,
    ...(proxy.caFile === undefined ? {} : { caFile: proxy.caFile }),
  })
}

export function startViewServer(
  config: ViewServeConfig,
  dependencies: ViewServerDependencies = DEFAULT_DEPENDENCIES,
): Server {
  const { session, proxy } = config
  const base = `/s/${session.nonce}`
  const hostDir = viewerDistDir()
  const proxyFetch = proxy.caFile ? fetchWithCaFile(proxy.caFile) : globalThis.fetch
  const owner =
    config.owner === undefined
      ? undefined
      : (dependencies.owner ?? ownerAccess)(config.owner, proxy)
  let status: PageStatus = { state: 'waiting', at: new Date().toISOString() }
  let viewGrants = new Map<string, AudienceGrants>()
  let kernelGrants = createGrantProvider()
  let lastActivity = Date.now()
  let revision = 0
  let refreshing: Promise<void> | undefined
  let switching = false
  /** The last write of the session record; each write lands after the one before it. */
  let recording: Promise<void> = Promise.resolve()
  /** Pages currently holding this session, by the id each one reports. */
  const pages = new Map<string, number>()
  /**
   * Pages a host has handed back. A release races the last heartbeat the page
   * had already sent, and a page that came back that way would hold the session
   * for its whole idle budget without anything left to report it gone.
   */
  const dropped = new Set<string>()
  /** Set once a host hands the session back; from then on the pages alone hold it. */
  let released = false
  let departure: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let shutdownTask: Promise<void> | undefined
  const exit = dependencies.exit ?? ((code: number) => process.exit(code))

  /**
   * Re-resolve the View, as `identity` when one is given, and start a new revision. New providers
   * are how the previous grants are invalidated: a mint still in flight for them can only ever
   * settle into the provider that started it.
   */
  async function renew(identity?: string): Promise<void> {
    const kernel =
      identity === undefined ? config.kernel : { ...config.kernel, as: identity, creds: undefined }
    const view = await refreshViewPlacement({ ...config, kernel }, dependencies.connect)
    const grant =
      identity !== undefined && view.route.handshake === 'shell'
        ? await mintGrant(kernel, view)
        : undefined
    await commit(view, grant, identity, () => {
      config.kernel = kernel
    })
  }

  /**
   * The owner-mode counterpart: the View is re-resolved as root whoever it runs as, and a switch to
   * `selected` is proven by a first grant minted for it before anything changes.
   */
  async function renewAsOwner(selected?: ViewIdentity): Promise<void> {
    const access = owner!
    const current = config.owner!
    const as =
      selected === undefined
        ? current.as
        : selected.id === null
          ? undefined
          : { id: selected.id, label: selected.label }
    const view = await access.resolveView(session.view)
    const grant =
      selected !== undefined && view.route.handshake === 'shell'
        ? await access.grant(as?.id, view)
        : undefined
    await commit(view, grant, selected?.label, () => {
      const { as: _previous, ...rest } = current
      config.owner = as === undefined ? rest : { ...rest, as }
    })
  }

  /**
   * Persist the new placement, then switch to it in one synchronous step: `apply` and the new
   * providers take effect together, so no mint can start between them.
   */
  async function commit(
    view: ViewServeConfig['session']['view'],
    grant: TokenGrant | undefined,
    identity: string | undefined,
    apply: () => void,
  ): Promise<void> {
    await record({
      ...session,
      pid: process.pid,
      ...(identity === undefined ? {} : { identity }),
      view,
    })
    apply()
    if (identity !== undefined) session.identity = identity
    session.view = view
    viewGrants = new Map()
    if (grant !== undefined) viewGrants.set(audienceOf(view), audienceGrants(view, grant))
    kernelGrants = createGrantProvider()
    revision += 1
    status = { state: 'waiting', at: new Date().toISOString() }
  }

  /** Write the session record after every write made before it, whichever settles first. */
  function record(next: ViewSessionRecord): Promise<void> {
    const write = recording.then(() => (dependencies.persist ?? saveRecord)(next))
    recording = write.catch(() => {})
    return write
  }

  /**
   * Hold the release of the session's View the Kernel answered with, read on `at`: the window moves
   * to it in place, so the page keeps its revision. A switch or refresh commits its own release.
   */
  function follow(view: ResolvedView, at: number): void {
    if (at !== revision || switching || refreshing !== undefined) return
    if (isDeepStrictEqual(view, session.view)) return
    session.view = view
    // The record only lists the session: a failed write leaves the window's answer as it is.
    void record({ ...session, pid: process.pid }).catch(() => {})
  }

  /** Whose credential `view`'s window runs on: its Domain's issuer, or the Kernel's. */
  function audienceOf(view: ResolvedView): string {
    return exchangedIssuer(view, proxy.issuer) ?? proxy.issuer
  }

  /** The View credential for the release `view` names, shared by every window that runs it. */
  async function viewGrant(view: ResolvedView): Promise<TokenGrant> {
    const audience = audienceOf(view)
    let grants = viewGrants.get(audience)
    if (grants === undefined) {
      grants = audienceGrants(view)
      viewGrants.set(audience, grants)
    }
    const fresh = await grants.credentials.acquire()
    return { token: fresh.credential, expiresAt: fresh.expiresAt, kind: grants.kind }
  }

  /** The grants of `view`'s audience, starting from `initial` when a switch already minted it. */
  function audienceGrants(view: ResolvedView, initial?: TokenGrant): AudienceGrants {
    const held: HeldGrant = { kind: initial?.kind ?? 'minted', expiresAt: initial?.expiresAt ?? 0 }
    return Object.assign(held, { credentials: createGrantProvider(view, initial, held) })
  }

  /**
   * Issue a caller-scoped bearer: `view`'s own credential when one is given, otherwise the host
   * page's Kernel credential. Raw CLI credentials never enter the browser session. Concurrent page
   * requests share one mint, and a grant is reused until it stops covering the View's own
   * delegation; `held` follows the grant the provider holds.
   *
   * Deliberately never started: this provider is request-scoped behind a client that already
   * anticipates. The Shell renews each window's credential on its own threshold (`viewer/main.ts`),
   * so the `POST /token` that reaches this server arrives on that schedule and never on a user
   * action. A timer here would instead mint delegations for a page that may have gone away, and
   * hold the event loop against the server's idle shutdown.
   */
  function createGrantProvider(
    view?: ResolvedView,
    initial?: TokenGrant,
    held?: HeldGrant,
  ): Credentials {
    return credentials({
      ttlSeconds: VIEW_DELEGATION_TTL_SECONDS,
      mint: async (): Promise<SessionCredential> => {
        const started = revision
        const previous = held?.expiresAt ?? 0
        if (held !== undefined) held.expiresAt = Number.POSITIVE_INFINITY
        try {
          const fresh =
            owner === undefined
              ? await mintGrant(config.kernel, view)
              : await owner.grant(config.owner?.as?.id, view)
          if (started !== revision)
            throw new AstraleError(
              'VIEW_SESSION_CHANGED',
              'View session changed; reload before requesting credentials.',
            )
          if (held !== undefined) {
            held.kind = fresh.kind
            held.expiresAt = fresh.expiresAt
          }
          return { credential: fresh.token, expiresAt: fresh.expiresAt }
        } catch (error) {
          if (held !== undefined) held.expiresAt = previous
          throw error
        }
      },
      ...(initial === undefined
        ? {}
        : { initial: { credential: initial.token, expiresAt: initial.expiresAt } }),
    })
  }

  async function mintGrant(
    kernel: ViewServeConfig['kernel'],
    view?: ViewServeConfig['session']['view'],
  ): Promise<TokenGrant> {
    return dependencies.connect(
      kernel,
      async ({ auth, target, identity }) => {
        // This session is bound to the Kernel it was opened against, exactly as
        // its placement refresh is. A bookmark re-pointed since then mints
        // nothing here: the View mounted from the old Kernel would receive a
        // bearer for another one.
        if (target.kernelIssuer !== proxy.issuer || target.url !== proxy.kernelUrl) {
          throw new AstraleError(
            'VIEW_KERNEL_CHANGED',
            'The session bookmark now points to another Kernel. Open a new View.',
          )
        }
        // The admitted mounted Publication owns this protocol, not the bookmark's Domain.
        const domainIssuer =
          view === undefined ? undefined : exchangedIssuer(view, target.kernelIssuer)
        if (domainIssuer !== undefined && kernel.creds === undefined) {
          const exchanged = await (dependencies.exchange ?? exchangeViewCredential)(
            { ...kernel, ...(identity === undefined ? {} : { as: identity }) },
            { ...target, domainIssuer },
          )
          return { ...exchanged, kind: 'exchanged' as const }
        }
        // A short-lived credential from the selected CLI identity proof.
        const token = await auth.mint({
          audience: target.kernelIssuer,
          ttlSeconds: VIEW_TOKEN_TTL_SECONDS,
        })
        return { token, expiresAt: mintedExpiry(token), kind: 'minted' as const }
      },
      {
        principal: 'caller',
        nestedTtlSeconds: VIEW_TOKEN_TTL_SECONDS,
      },
    )
  }

  const server = createServer((req, res) => {
    lastActivity = Date.now()
    void route(req, res).catch((error: unknown) => {
      if (res.destroyed) return
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : new InternalError(String(error)))
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      // CORS headers even on failures — the caller may be the cross-origin
      // view iframe, and an opaque error reads as a network failure there.
      res.writeHead(502, {
        'content-type': 'application/json',
        ...corsHeaders(req.headers.origin),
      })
      res.end(JSON.stringify({ error: message }))
    })
  })

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(`${base}/`) && url.pathname !== base) {
      res.writeHead(404).end()
      return
    }
    const sub = url.pathname.slice(base.length) || '/'

    // A custom header prevents cross-origin simple requests; no preflight is admitted here.
    if (HOST_ONLY_ROUTES.includes(sub)) {
      const address = server.address()
      const origin =
        typeof address === 'object' && address !== null ? `http://127.0.0.1:${address.port}` : ''
      if (
        origin === '' ||
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin !== undefined && req.headers.origin !== origin) ||
        req.headers['x-astrale-view-host'] !== '1'
      ) {
        json(res, 403, { error: 'This operation is restricted to the View host.' })
        return
      }
      // Only a page acting on the identity in force has to agree on the revision:
      // reading the config is how a fresh page learns it, listing identities acts
      // on none, and a host releasing a session holds no page revision at all.
      if (
        (config.identities?.length || owner !== undefined) &&
        !REVISION_FREE_ROUTES.includes(sub) &&
        req.headers['x-astrale-view-revision'] !== String(revision)
      ) {
        json(res, 409, { error: 'View session changed; reload before continuing.' })
        return
      }
    }

    if (sub === '/k' || sub.startsWith('/k/')) {
      await proxyKernel(req, res, sub.slice('/k'.length), url.search)
      return
    }
    if (sub === '/' || sub === '/index.html') {
      await serveAsset(res, join(hostDir, 'index.html'), 'text/html; charset=utf-8')
      return
    }
    const assetType = viewerFileContentType(sub)
    if (assetType !== undefined) {
      await serveAsset(res, join(hostDir, sub), assetType)
      return
    }
    if (sub === '/config.json' && req.method === 'GET') {
      json(res, 200, {
        view: session.view,
        kernelUrl: proxy.direct ? proxy.kernelUrl : `${base}/k`,
        kernelIssuer: proxy.issuer,
        identity:
          config.owner === undefined
            ? (session.identity ?? null)
            : (config.owner.as?.label ?? ROOT_IDENTITY.label),
        instance: session.instance ?? null,
        sessionId: session.id,
        externalOrigins: config.externalOrigins,
        delegationTtlSeconds: VIEW_DELEGATION_TTL_SECONDS,
        revision,
        ...(config.identities ? { identities: config.identities } : {}),
        // The page then lists what the View may run as from `/identities`.
        ...(config.owner === undefined ? {} : { owner: true }),
      })
      return
    }
    if (sub === '/identities' && req.method === 'GET') {
      if (owner === undefined) {
        json(res, 404, { error: 'This View session runs as one identity only.' })
        return
      }
      json(res, 200, {
        selected: config.owner?.as?.id ?? null,
        identities: await owner.identities(),
      })
      return
    }
    if (sub === '/current' && req.method === 'GET') {
      const at = revision
      const view = await currentRelease()
      if (view !== null) follow(view, at)
      json(res, 200, { view })
      return
    }
    if ((sub === '/token' || sub === '/kernel-token') && req.method === 'POST') {
      if (switching) {
        json(res, 409, { error: 'Identity switch in progress.' })
        return
      }
      if (session.view.route.handshake !== 'shell') {
        json(res, 403, { error: 'plain views have no Astrale credential privilege' })
        return
      }
      // The host calls the Kernel as the caller; each window receives the credential of the
      // release it runs. Never authenticate a Kernel whoami/read with a window's Domain bearer.
      if (sub === '/kernel-token') {
        const fresh = await kernelGrants.acquire()
        json(res, 200, { token: fresh.credential, expiresAt: fresh.expiresAt, kind: 'minted' })
        return
      }
      const view = requestedView(await readJson(req))
      if (view === undefined) {
        json(res, 400, { error: 'Name the View release the credential is for.' })
        return
      }
      if (view.route.handshake !== 'shell') {
        json(res, 403, { error: 'plain views have no Astrale credential privilege' })
        return
      }
      json(res, 200, await viewGrant(view))
      return
    }
    if (sub === '/identity' && req.method === 'POST' && owner !== undefined) {
      await switchAsOwner(req, res, owner)
      return
    }
    if (sub === '/identity' && req.method === 'POST') {
      const body = await readJson(req)
      const identity = body?.identity
      if (
        typeof identity !== 'string' ||
        !config.identities?.includes(identity) ||
        config.kernel.creds
      ) {
        json(res, 403, { error: 'Identity was not allowed for this View session.' })
        return
      }
      if (switching || refreshing) {
        json(res, 409, { error: 'View session update in progress.' })
        return
      }
      // The body may have arrived after another page finished switching.
      if (req.headers['x-astrale-view-revision'] !== String(revision)) {
        json(res, 409, { error: 'View session changed; reload before continuing.' })
        return
      }
      switching = true
      try {
        await renew(identity)
        json(res, 200, { revision })
      } finally {
        switching = false
      }
      return
    }
    if (sub === '/status' && req.method === 'POST') {
      const body = await readJson(req)
      const page = asString(body?.page)
      const state = asString(body?.state)
      if (page !== undefined) {
        if (state === 'gone') depart(page)
        else attach(page)
      }
      // `gone` is the page leaving, not a state the View reached, so it never
      // becomes the status a `--snapshot` run is waiting on.
      if (state !== undefined && state !== 'alive' && state !== 'gone') {
        status = { state, error: asString(body?.error), at: new Date().toISOString() }
      }
      json(res, 200, { revision })
      return
    }
    if (sub === '/release' && req.method === 'POST') {
      const body = await readJson(req)
      const page = asString(body?.page)
      released = true
      if (page !== undefined) {
        pages.delete(page)
        dropped.add(page)
      }
      scheduleDeparture()
      json(res, 200, { released: true, attached: pages.size })
      return
    }
    if (sub === '/refresh' && req.method === 'POST') {
      if (switching) {
        json(res, 409, { error: 'Identity switch in progress.' })
        return
      }
      // Concurrent requests share one resolution; a failed resolution retains the last good View.
      refreshing ??= (owner === undefined ? renew() : renewAsOwner()).finally(() => {
        refreshing = undefined
      })
      await refreshing
      json(res, 200, { revision })
      return
    }
    if (sub === '/state' && req.method === 'GET') {
      json(res, 200, status)
      return
    }
    res.writeHead(404).end()
  }

  /**
   * The release of the session's View the Kernel serves now, read under the authority that resolved
   * it - root in owner mode - or `null` once its Domain publishes it no longer. Any other failure is
   * no answer, and the window keeps the release it runs.
   */
  async function currentRelease(): Promise<ResolvedView | null> {
    try {
      return owner === undefined
        ? await refreshViewPlacement(config, dependencies.connect)
        : await owner.resolveView(session.view)
    } catch (error) {
      if (error instanceof AstraleError && error.code === 'VIEW_NOT_FOUND') return null
      throw error
    }
  }

  /**
   * Run the View as `{ identity }`: an Identity node id, or `null` for the instance root. Only an
   * identity the instance lists right now, read as root, is admitted.
   */
  async function switchAsOwner(
    req: IncomingMessage,
    res: ServerResponse,
    access: OwnerAccess,
  ): Promise<void> {
    const body = await readJson(req)
    const wanted = body?.identity
    if (wanted !== null && typeof wanted !== 'string') {
      json(res, 403, { error: 'Identity was not allowed for this View session.' })
      return
    }
    if (switching || refreshing) {
      json(res, 409, { error: 'View session update in progress.' })
      return
    }
    // The body may have arrived after another page finished switching.
    if (req.headers['x-astrale-view-revision'] !== String(revision)) {
      json(res, 409, { error: 'View session changed; reload before continuing.' })
      return
    }
    switching = true
    try {
      const selected = (await access.identities()).find((identity) => identity.id === wanted)
      if (selected === undefined) {
        json(res, 403, { error: 'Identity was not allowed for this View session.' })
        return
      }
      await renewAsOwner(selected)
      json(res, 200, { revision })
    } finally {
      switching = false
    }
  }

  /** Forward a kernel call: verbatim headers/body both ways, CORS added. */
  async function proxyKernel(
    req: IncomingMessage,
    res: ServerResponse,
    suffix: string,
    search: string,
  ): Promise<void> {
    const origin = req.headers.origin
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(origin)).end()
      return
    }
    const target = joinUrl(proxy.kernelUrl, suffix) + search
    const headers: Record<string, string> = {}
    for (const name of ['authorization', 'content-type', 'accept']) {
      const value = req.headers[name]
      if (typeof value === 'string') headers[name] = value
    }
    // Buffer the request body (envelope requests are small JSON): the caFile
    // fetch path speaks node https and cannot consume a web-stream body.
    // Response bodies still stream through.
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    const body = hasBody ? Buffer.concat(await collect(req)) : undefined
    const controller = new AbortController()
    const abort = () => {
      if (!res.writableFinished) controller.abort()
    }
    res.once('close', abort)
    if (res.destroyed) abort()
    try {
      const upstream = await proxyFetch(target, {
        method: req.method,
        headers,
        signal: controller.signal,
        ...(body !== undefined ? { body } : {}),
      } as RequestInit)
      const responseHeaders: Record<string, string> = corsHeaders(origin)
      const contentType = upstream.headers.get('content-type')
      if (contentType) responseHeaders['content-type'] = contentType
      res.writeHead(upstream.status, responseHeaders)
      if (upstream.body) {
        await pipeline(Readable.fromWeb(upstream.body as unknown as WebReadableStream), res)
      } else {
        res.end()
      }
    } finally {
      res.off('close', abort)
    }
  }

  /** A page is holding the session; anything scheduled against its absence is off. */
  function attach(page: string): void {
    if (dropped.has(page)) return
    pages.set(page, Date.now())
    if (departure === undefined) return
    clearTimeout(departure)
    departure = undefined
  }

  function depart(page: string): void {
    pages.delete(page)
    scheduleDeparture()
  }

  /**
   * A released session with no page left is nobody's. Shut it down once the
   * grace has passed without a page taking it back: a reload leaves and returns,
   * and so does the tab the operator popped the View out into.
   */
  function scheduleDeparture(): void {
    if (disposed || !released || pages.size > 0 || departure !== undefined) return
    departure = setTimeout(() => {
      departure = undefined
      if (released && pages.size === 0) void shutdown(0)
    }, config.releaseGraceMs ?? RELEASE_GRACE_MS)
    departure.unref()
  }

  const idleTimer = setInterval(() => {
    const now = Date.now()
    if (now - lastActivity > config.idleMs) void shutdown(0)
    // A release no window asked for within its grant's lifetime is no longer run here.
    for (const [audience, grants] of viewGrants) {
      if (grants.expiresAt <= now) viewGrants.delete(audience)
    }
  }, IDLE_SWEEP_MS)
  idleTimer.unref()

  /** The returned HTTP server owns exactly these timers and signal subscriptions. */
  function dispose(): void {
    if (disposed) return
    disposed = true
    clearInterval(idleTimer)
    if (departure !== undefined) {
      clearTimeout(departure)
      departure = undefined
    }
    process.off('SIGTERM', terminate)
    process.off('SIGINT', terminate)
    owner?.close()
  }
  // Stop owning background work as soon as close is requested, even if an in-flight HTTP request
  // must finish before the close event. Closing a library-created server never exits its caller.
  const closeHttpServer = server.close.bind(server)
  server.close = (callback) => {
    dispose()
    return closeHttpServer(callback)
  }
  server.once('close', dispose)

  function shutdown(code: number): Promise<void> {
    if (shutdownTask !== undefined) return shutdownTask
    if (disposed) return Promise.resolve()
    shutdownTask = (async () => {
      server.close()
      await removeSessionFiles(session.id)
      exit(code)
    })()
    return shutdownTask
  }
  const terminate = () => void shutdown(0)
  process.on('SIGTERM', terminate)
  process.on('SIGINT', terminate)

  server.listen(session.port, '127.0.0.1')
  return server
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, accept',
    // Chrome private-network-access preflight (public page → loopback proxy).
    'access-control-allow-private-network': 'true',
    'access-control-max-age': '600',
    vary: 'origin',
  }
}

function joinUrl(baseUrl: string, suffix: string): string {
  if (!suffix) return baseUrl
  return baseUrl.replace(/\/$/, '') + suffix
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function serveAsset(res: ServerResponse, file: string, contentType: string): Promise<void> {
  try {
    const content = await readFile(file)
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    })
    res.end(content)
  } catch {
    res.writeHead(404).end()
  }
}

async function collect(req: IncomingMessage): Promise<Buffer[]> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return chunks
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(Buffer.concat(await collect(req)).toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * The View release a host request names (`{ view }`), as the Shell resolved it: its target and
 * route, whose issuer is a valid issuer when it has one. Anything else names none.
 */
function requestedView(body: Record<string, unknown> | null): ResolvedView | undefined {
  const view = body?.view
  if (typeof view !== 'object' || view === null) return undefined
  const { target, route } = view as { target?: unknown; route?: unknown }
  if (typeof target !== 'string' || typeof route !== 'object' || route === null) return undefined
  const { key, handshake, issuer } = route as Record<string, unknown>
  if (typeof key !== 'string' || (handshake !== 'shell' && handshake !== 'none')) return undefined
  if (issuer !== undefined && (typeof issuer !== 'string' || !isIssuer(issuer))) return undefined
  return view as ResolvedView
}

function isIssuer(value: string): boolean {
  try {
    issuerId.accept(value)
    return true
  } catch {
    return false
  }
}
