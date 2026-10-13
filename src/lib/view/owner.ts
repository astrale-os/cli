import type { Node, NodeId } from '@astrale-os/sdk/graph/node'
import type { ClassRef } from '@astrale-os/sdk/schema'
import type { ResolvedView } from '@astrale-os/shell'

import { credential, issuer } from '@astrale-os/sdk/auth'
import { createGraph } from '@astrale-os/sdk/client'
import { ClientSession, credentials, type SessionAuth } from '@astrale-os/sdk/client/session'
import { Query } from '@astrale-os/sdk/query'
import { K } from '@astrale-os/sdk/schema'

import type { InstanceRootToken } from '../../admin/instance'
import type { AdminConnectionOptions } from '../../connection'
import type { ConnectionOptions, ConnectionTarget } from '../../connection/target'
import type { InstanceOwnership } from '../admin/ownership'
import type { ViewResolutionContext } from './resolve'
import type { ViewOwnerConfig } from './session'

import { readAllNodes } from '../../admin/graph'
import { adminSessionOptions } from '../../connection'
import {
  createClientSessionOptions,
  lookupManagedInstance,
  resolveTimeoutMs,
} from '../../connection/session'
import { resolveConnectionTarget } from '../../connection/target'
import { AstraleError } from '../../errors'
import { resolveInstanceOwnership, retrieveInstanceRootToken } from '../admin/instances'
import { kernelKey } from '../admin/ownership'
import { fetchWithCaFile } from '../ca-fetch'
import { readConfig } from '../config'
import { mintedExpiry, runsOnKernelCredential, type TokenGrant } from './grant'
import { reresolveView } from './refresh'

/**
 * Owner mode of a View session: the Admin back-office mechanism, run by the CLI.
 *
 * The session holds the instance root token Admin issues to the Instance's owner
 * (`Instance.retrieveRootToken`), resolves Views as root, and runs the View as root or as any
 * Identity of the instance through `impersonate`. Resolution belongs to the owner: a View opened
 * "as" an Identity never requires that Identity to be allowed to discover it. The root token and
 * the impersonation token stay in this process; the page only receives the grants derived from
 * them, exactly as in an ordinary session.
 *
 * Nothing outlives its expiry: a revoked ownership makes the next root renewal fail in Admin, and
 * every grant minted after that fails with it.
 */

/** Delegation the page anticipates against; it is the session server's own threshold. */
const PAGE_DELEGATION_TTL_SECONDS = 60
/** Each grant the page receives: it must outlast the delegation the page anticipates against. */
const GRANT_TTL_SECONDS = 2 * PAGE_DELEGATION_TTL_SECONDS
/**
 * An impersonation token renews once it stops covering one grant, so it lives one delegation more
 * than a grant.
 */
const IMPERSONATION_TTL_SECONDS = GRANT_TTL_SECONDS + PAGE_DELEGATION_TTL_SECONDS
/**
 * Coverage the held root token must retain: the Kernel refuses to issue a credential outliving the
 * one presented, so root has to cover the longest credential minted through it, the impersonation.
 * Admin issues root for 300 seconds, so it renews roughly every two minutes.
 */
const ROOT_COVERAGE_TTL_SECONDS = IMPERSONATION_TTL_SECONDS
const MAXIMUM_IDENTITIES = 10_000

/** One identity the View may run as: the instance root, or an Identity node of the instance. */
export interface ViewIdentity {
  /** The Identity node id; `null` for the instance root. */
  readonly id: string | null
  readonly label: string
  readonly kind: 'root' | 'user' | 'identity'
  /** The Identity's class name, shown beside an identity that is not a User. */
  readonly className?: string
}

export const ROOT_IDENTITY: ViewIdentity = Object.freeze({ id: null, label: 'Root', kind: 'root' })

/** The Shell's User class: every Shell User and every subclass a Domain derives from it. */
const SHELL_USER = Object.freeze({
  origin: 'shell.astrale.ai',
  kind: 'class',
  name: 'User',
}) as ClassRef

const IDENTITIES = Query.from({ nodes: [K.classes.Identity] }).select({
  kind: 'nodes',
  projection: { kind: 'value' },
})
const USERS = Query.from({ nodes: [SHELL_USER] }).select({
  kind: 'nodes',
  projection: { kind: 'value' },
})

/** The instance Kernel a session reaches, exactly as its proxy records it. */
export interface OwnerKernel {
  readonly url: string
  readonly issuer: string
  readonly caFile?: string
}

export interface OwnerAccess {
  /** The root Session and the Kernel it reaches, to resolve Views as the owner. */
  readonly context: ViewResolutionContext
  /** The placement the View's Domain publishes now, read as root. */
  resolveView(current: ResolvedView): Promise<ResolvedView>
  /** Root first, then every Identity of the instance read as root: Users, then the others. */
  identities(): Promise<readonly ViewIdentity[]>
  /**
   * A grant for `identity` (root when absent): the View's own credential when `view` is given,
   * otherwise the host page's Kernel credential.
   */
  grant(identity: string | undefined, view?: ResolvedView): Promise<TokenGrant>
  close(): void
}

interface OwnedSession {
  readonly session: ClientSession
  close(): void
}

export interface OwnerAccessDependencies {
  readonly rootToken: (
    owner: Pick<ViewOwnerConfig, 'instance' | 'admin'>,
  ) => Promise<InstanceRootToken>
  readonly open: (kernel: OwnerKernel, auth: SessionAuth) => OwnedSession
}

const DEFAULT_DEPENDENCIES: OwnerAccessDependencies = Object.freeze<OwnerAccessDependencies>({
  rootToken: (owner) => retrieveInstanceRootToken(owner.admin, owner.instance),
  open: (kernel, auth) => {
    const fetch = kernel.caFile === undefined ? globalThis.fetch : fetchWithCaFile(kernel.caFile)
    const target = { url: kernel.url, kernelIssuer: issuer.accept(kernel.issuer) }
    // Root and impersonated routes stay in this process's memory: a route derived from an owner
    // credential is never written to the CLI's shared on-disk route store.
    const { routeStore: _persisted, ...options } = createClientSessionOptions(
      target,
      fetch,
      auth,
      resolveTimeoutMs(undefined),
    )
    const session = new ClientSession(options)
    return { session, close: () => session.close() }
  },
})

export function createOwnerAccess(
  owner: Pick<ViewOwnerConfig, 'instance' | 'admin'>,
  kernel: OwnerKernel,
  dependencies: Partial<OwnerAccessDependencies> = {},
): OwnerAccess {
  const { rootToken, open } = { ...DEFAULT_DEPENDENCIES, ...dependencies }
  // One root credential for the session: concurrent requests share one Admin round trip, and it is
  // renewed once it stops covering the impersonation it mints, never on a guessed margin. It is
  // never started: like the grants, it is acquired on demand, so a session nobody uses asks Admin
  // for nothing.
  const root = open(
    kernel,
    credentials({
      ttlSeconds: ROOT_COVERAGE_TTL_SECONDS,
      mint: async () => {
        const next = await rootToken(owner)
        if (kernelKey(next.issuer) !== kernelKey(kernel.issuer)) {
          throw new AstraleError(
            'VIEW_OWNER_TARGET_CHANGED',
            'Admin issued root access for another Kernel than this View session. Open a new View.',
          )
        }
        return { credential: next.token, expiresAt: next.expiresAt * 1_000 }
      },
    }),
  )
  let impersonated: (OwnedSession & { readonly identity: string }) | undefined
  const context: ViewResolutionContext = Object.freeze({
    session: root.session,
    target: Object.freeze({ url: kernel.url }),
  })

  /** The Session that runs as `identity`; one impersonation is held at a time. */
  function sessionAs(identity: string | undefined): ClientSession {
    if (identity === undefined) return root.session
    if (impersonated?.identity !== identity) {
      impersonated?.close()
      const source = credentials({
        ttlSeconds: GRANT_TTL_SECONDS,
        mint: async (signal) => {
          const minted = await root.session.auth.impersonate(
            { identity: identity as NodeId, ttlSeconds: IMPERSONATION_TTL_SECONDS },
            { signal },
          )
          const inspected = credential.inspect(minted)
          if (inspected.sub !== identity) {
            throw new TypeError('The impersonation token subject does not match the identity.')
          }
          const expires = inspected.claims.exp
          if (typeof expires !== 'number' || !Number.isSafeInteger(expires)) {
            throw new TypeError('The impersonation token has no usable expiry.')
          }
          return { credential: minted, expiresAt: expires * 1_000 }
        },
      })
      impersonated = { identity, ...open(kernel, source) }
    }
    return impersonated.session
  }

  return Object.freeze({
    context,
    resolveView: (current: ResolvedView) => reresolveView(context, current),
    async identities() {
      const graph = createGraph((call, request) => root.session.call(call, request))
      const bound = { maximum: MAXIMUM_IDENTITIES, maximumPages: 40 }
      const [nodes, users] = await Promise.all([
        readAllNodes(graph, IDENTITIES, { label: 'Instance identities', ...bound }),
        readAllNodes(graph, USERS, { label: 'Instance users', ...bound }),
      ])
      return listIdentities(nodes, users)
    },
    async grant(identity: string | undefined, view?: ResolvedView): Promise<TokenGrant> {
      const session = sessionAs(identity)
      if (view !== undefined && !runsOnKernelCredential(view, kernel.issuer)) {
        const exchanged = await session.exchange(view.route.issuer, {
          ttlSeconds: GRANT_TTL_SECONDS,
        })
        return { token: exchanged.credential, expiresAt: exchanged.expiresAt, kind: 'exchanged' }
      }
      const token = await session.auth.mint({
        audience: kernel.issuer,
        ttlSeconds: GRANT_TTL_SECONDS,
      })
      return { token, expiresAt: mintedExpiry(token), kind: 'minted' }
    },
    close() {
      impersonated?.close()
      impersonated = undefined
      root.close()
    },
  })
}

/** Run `action` with owner access to one instance, then release it. */
export async function withOwnerAccess<Value>(
  owner: Pick<ViewOwnerConfig, 'instance' | 'admin'>,
  kernel: OwnerKernel,
  action: (access: OwnerAccess) => Promise<Value>,
  dependencies: Partial<OwnerAccessDependencies> = {},
): Promise<Value> {
  const access = createOwnerAccess(owner, kernel, dependencies)
  try {
    return await action(access)
  } finally {
    access.close()
  }
}

/**
 * Root first, then the Users, then every other Identity with its class name, each group in label
 * order. The instance decides who is a User, through the Shell class and its subclasses.
 */
export function listIdentities(
  nodes: readonly Node[],
  users: readonly Node[],
): readonly ViewIdentity[] {
  const userIds = new Set(users.map((node) => String(node.id)))
  const listed = nodes.map((node): ViewIdentity =>
    userIds.has(String(node.id))
      ? { id: String(node.id), label: identityLabel(node), kind: 'user' }
      : {
          id: String(node.id),
          label: identityLabel(node),
          kind: 'identity',
          className: className(node.class),
        },
  )
  const byLabel = (left: ViewIdentity, right: ViewIdentity) =>
    left.label.localeCompare(right.label) || String(left.id).localeCompare(String(right.id))
  return Object.freeze([
    ROOT_IDENTITY,
    ...listed.filter((identity) => identity.kind === 'user').sort(byLabel),
    ...listed
      .filter((identity) => identity.kind === 'identity')
      .sort(
        (left, right) =>
          (left.className ?? '').localeCompare(right.className ?? '') || byLabel(left, right),
      ),
  ])
}

/** Naming properties an Identity carries, by property name and in order of preference. */
const NAMING = ['email', 'name', 'sub', 'title', 'label', 'slug', 'key'] as const

/** How an Identity reads: its email, its name, its subject, else its id. */
export function identityLabel(node: Node): string {
  const props = node.props as Readonly<Record<string, unknown>>
  const named = props[K.classes.Named.properties.name.key]
  const origin = props[K.classes.Domain.properties.origin.key]
  for (const wanted of NAMING) {
    if (wanted === 'name' && typeof named === 'string' && named !== '') return named
    for (const [key, value] of Object.entries(props)) {
      if (key.endsWith(`.property.${wanted}`) && typeof value === 'string' && value !== '')
        return value
    }
  }
  return typeof origin === 'string' && origin !== '' ? origin : String(node.id)
}

/** `origin:class.Name` reads as `Name`. */
function className(key: string): string {
  const marker = key.lastIndexOf(':class.')
  return marker === -1 ? key : key.slice(marker + ':class.'.length)
}

/** The instance Kernel a View session for `options` reaches, without authenticating to it. */
export async function resolveViewTarget(options: ConnectionOptions): Promise<ConnectionTarget> {
  return resolveConnectionTarget(options, await readConfig(), {
    managed: (slug) => lookupManagedInstance(slug, options),
  })
}

/**
 * Whether the caller owns, in Admin, the instance a View session for `options` reaches. The Admin
 * session keeps the caller's default identity and drops the instance's own target and credential.
 */
export async function resolveViewOwnership(options: ConnectionOptions): Promise<{
  readonly ownership: InstanceOwnership
  readonly admin: AdminConnectionOptions
}> {
  const target = await resolveViewTarget(options)
  const admin = adminSessionOptions(options)
  const ownership = await resolveInstanceOwnership(admin, {
    url: target.url,
    issuer: target.kernelIssuer,
  })
  return Object.freeze({ ownership, admin })
}
