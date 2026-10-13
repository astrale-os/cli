import type { SessionAuth } from '@astrale-os/sdk/client/session'
import type { Node } from '@astrale-os/sdk/graph/node'

import { credential } from '@astrale-os/sdk/auth'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { K } from '@astrale-os/sdk/schema'
import { expect, mock } from 'bun:test'

import type { InstanceRootToken } from '../../admin/instance'
import type { OwnerAccessDependencies } from '../view/owner'
import type { ViewServeConfig } from '../view/session'

import { mintedCredential } from './view.fixture'

export type View = ViewServeConfig['session']['view']

export const KERNEL = 'https://kernel.test'
export const OWNER = { instance: '@admin-instance', admin: { timeout: '5000' } }
export const seconds = (fromNow: number) => Math.floor(Date.now() / 1_000) + fromNow

export const view = (key: string, issuer: string): View =>
  ({
    target: `/:${key.slice(0, key.indexOf(':view.'))}`,
    route: {
      key,
      declaration: { target: { kind: 'domain' } },
      href: `https://views.test/${key}`,
      handshake: 'shell',
      issuer,
      release: `sha256:${'a'.repeat(64)}`,
      revision: `sha256:${'b'.repeat(64)}`,
    },
  }) as unknown as View

export const DOMAIN_VIEW = view('issues.example:view.board', 'https://issues.example')
export const KERNEL_VIEW = view('local.example:view.board', KERNEL)
export const SHELL_VIEW = view('shell.astrale.ai:view.application', 'https://shell.astrale.ai')

export const node = (id: string, cls: string, props: Record<string, unknown>): Node =>
  Object.freeze({ id: NodeId(id), class: cls, props: normalizeProperties(props) }) as Node

const USER = 'shell.astrale.ai:class.User'
export const ALICE = node('alice', USER, {
  'shell.astrale.ai:class.User.property.email': 'alice@x.test',
})
export const BOB = node('bob', USER, { 'shell.astrale.ai:class.User.property.email': 'bob@x.test' })
export const AGENT = node('agent', 'agents.astrale.ai:class.Agent', {
  [K.classes.Named.properties.name.key]: 'Support agent',
})

/**
 * An instance Kernel doubled at its Session boundary. Every operation first presents the credential
 * its Session auth resolves, exactly as a real Session would, so the test sees which authority
 * each grant came from.
 */
export function instanceKernel(
  input: {
    rootToken?: OwnerAccessDependencies['rootToken']
    impersonatedSubject?: (identity: string) => string
    /** What the Domain catalog publishes, read as root. */
    routes?: readonly View['route'][]
  } = {},
) {
  const presented: string[] = []
  /** Every root and impersonation token the instance ever issued: none may reach a page. */
  const authorities: string[] = []
  const closed: string[] = []
  const rootToken = mock(
    input.rootToken ??
      (async (): Promise<InstanceRootToken> => {
        const token = mintedCredential('root', seconds(300))
        authorities.push(token)
        return { token, issuer: `${KERNEL}/`, expiresAt: seconds(300) }
      }),
  )
  const impersonate = mock(
    async ({ identity, ttlSeconds }: { identity: string; ttlSeconds: number }) => {
      if ((await present()) !== 'root') throw new Error('Only root impersonates.')
      const token = mintedCredential(
        input.impersonatedSubject?.(identity) ?? identity,
        seconds(ttlSeconds),
      )
      authorities.push(token)
      return token
    },
  )
  let auth: SessionAuth | undefined
  const sessions: Array<{ auth: SessionAuth }> = []
  async function presentWith(source: SessionAuth): Promise<string> {
    const { credential: token } = await source.resolve({} as never, new AbortController().signal)
    if (token === undefined) throw new Error('No credential presented.')
    presented.push(token)
    return credential.inspect(token).sub!
  }
  const present = () => presentWith(auth!)
  const open: OwnerAccessDependencies['open'] = (kernel, source) => {
    expect(kernel).toEqual({ url: KERNEL, issuer: KERNEL })
    const own = { auth: source }
    sessions.push(own)
    const by = () => presentWith(source)
    if (auth === undefined) auth = source
    const graph = async (call: { input: { ast: unknown } }) => {
      await by()
      const users = JSON.stringify(call.input.ast).includes('shell.astrale.ai')
      const nodes = users ? [ALICE, BOB] : [AGENT, BOB, ALICE]
      return {
        result: { kind: 'nodes', nodes: nodes.map((value) => ({ kind: 'value', value })) },
        page: {},
      }
    }
    return {
      session: {
        auth: {
          impersonate,
          mint: async ({ ttlSeconds }: { ttlSeconds: number }) =>
            mintedCredential(`grant:${await by()}`, seconds(ttlSeconds)),
        },
        exchange: async (issuer: string, { ttlSeconds }: { ttlSeconds: number }) => ({
          credential: `exchanged:${await by()}@${issuer}`,
          expiresAt: Date.now() + ttlSeconds * 1_000,
        }),
        viewsFor: async () => ({ views: input.routes ?? [DOMAIN_VIEW.route] }),
        call: graph,
      } as never,
      close: () => closed.push(String(sessions.indexOf(own))),
    }
  }
  return { rootToken, open, impersonate, presented, authorities, closed }
}
