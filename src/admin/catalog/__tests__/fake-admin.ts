import type { Node } from '@astrale-os/sdk/graph/node'
import type { QueryAST } from '@astrale-os/sdk/query'

import { ResponseError } from '@astrale-os/sdk/client'
import { ClassKey } from '@astrale-os/sdk/graph/class'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { mock } from 'bun:test'

import type { AdminGraphApi } from '../../graph'

import { adminSession } from '../../__tests__/fixture'
import { AdminContract } from '../../contract'

/** The catalog relations of Admin #446: one Domain per origin, contained or listed by Fleets. */
export type FakeRelation =
  | 'fleet_contains'
  | 'fleet_lists_domain'
  | 'fleet_installs_domain_by_default'

export interface FakeDomain {
  readonly id: string
  readonly origin: string
  readonly name?: string
  readonly discoveryUrl?: string
  readonly description?: string
}

export interface FakeAdminInput {
  /** The Fleet with slug `default` is the core Fleet. */
  readonly fleets: ReadonlyArray<Readonly<{ id: string; slug: string }>>
  readonly domains?: readonly FakeDomain[]
  readonly instances?: ReadonlyArray<Readonly<{ id: string; slug: string }>>
  /** `[relation, source id, target id]`. */
  readonly edges?: ReadonlyArray<readonly [FakeRelation, string, string]>
  /** Break the Kernel's distinct Node selection: answer one row per Edge witness. */
  readonly witnesses?: boolean
}

const AT = '2026-10-05T00:00:00.000Z'
const INVOCATION = { source: 'https://admin.test', id: 'fake-admin' } as ConstructorParameters<
  typeof ResponseError
>[2]
const property = AdminContract.properties
const FLEET_SLUG = 'admin.astrale.ai:class.Fleet.property.slug'
const METHOD = (owner: 'Fleet' | 'Instance', name: string) =>
  `admin.astrale.ai:class.${owner}.method.${name}`

/**
 * An in-memory Admin of the merged catalog (admin #446): it answers the CLI's Graph reads by
 * following the named relations, and serves `Fleet.publishDomain` (with the M2 refusal of a new
 * origin outside the core Fleet), `Fleet.configureDomainDefault` and `Instance.installDomain`.
 * Any other callable, the removed `Domain.configureDefault` included, is METHOD_NOT_FOUND.
 */
export function fakeAdmin(input: FakeAdminInput) {
  const core = input.fleets.find((fleet) => fleet.slug === 'default')?.id
  const nodes = new Map<string, Node>()
  for (const fleet of input.fleets)
    nodes.set(fleet.id, node(fleet.id, 'Fleet', { [FLEET_SLUG]: fleet.slug }))
  for (const domain of input.domains ?? []) nodes.set(domain.id, domainNode(domain))
  for (const instance of input.instances ?? [])
    nodes.set(
      instance.id,
      node(instance.id, 'Instance', {
        [property.instance.slug]: instance.slug,
        [property.instance.url]: `https://${instance.slug}.eu.astrale.ai`,
        [property.instance.state]: 'ready',
        [property.instance.createdAt]: AT,
        [property.instance.updatedAt]: AT,
      }),
    )
  const edges = (input.edges ?? []).map(([relation, source, target]) => ({
    relation,
    source,
    target,
  }))
  const domains = new Map((input.domains ?? []).map((domain) => [domain.id, { ...domain }]))
  const calls: Array<{ target: string; value: unknown }> = []

  const reached = (fleet: string, relations: readonly FakeRelation[]) =>
    edges
      .filter((edge) => edge.source === fleet && relations.includes(edge.relation))
      .map((edge) => edge.target)
  const catalog = (fleet: string) =>
    new Set(
      reached(fleet, ['fleet_contains', 'fleet_lists_domain']).filter((id) => domains.has(id)),
    )

  const invoke = (target: string, value: Readonly<Record<string, unknown>>): unknown => {
    const [receiver, method] = target.split('::') as [string, string]
    const self = idOf(receiver, core)
    if (method === METHOD('Fleet', 'publishDomain')) {
      const origin = String(value.origin)
      const contained = reached(self, ['fleet_contains'])
        .map((id) => domains.get(id))
        .find((domain) => domain?.origin === origin)
      if (contained === undefined) {
        const elsewhere = [...domains.values()].some((domain) => domain.origin === origin)
        if (self !== core || elsewhere)
          throw new ResponseError(
            4001,
            "Only the Fleet that contains an origin's Domain repoints it, and only the core Fleet catalogues a new origin.",
            INVOCATION,
            {
              code: 'CATALOG_ORIGIN_CONFLICT',
              details: { origin, reason: self !== core ? 'not-in-fleet' : 'in-another-fleet' },
            },
          )
      }
      const domain: FakeDomain = {
        id: contained?.id ?? `${origin.split('.')[0]}-domain`,
        origin,
        name: String(value.name),
        discoveryUrl: String(value.discoveryUrl),
        ...(value.description === undefined ? {} : { description: String(value.description) }),
      }
      domains.set(domain.id, domain)
      nodes.set(domain.id, domainNode(domain))
      if (contained === undefined)
        edges.push({ relation: 'fleet_contains', source: self, target: domain.id })
      return summary(domain)
    }
    if (method === METHOD('Fleet', 'configureDomainDefault')) {
      const domain = domains.get(idOf(String(value.domain)))
      if (domain === undefined || !catalog(self).has(domain.id))
        throw new ResponseError(5000, 'Internal application error.', INVOCATION)
      const current = edges.findIndex(
        (edge) =>
          edge.relation === 'fleet_installs_domain_by_default' &&
          edge.source === self &&
          edge.target === domain.id,
      )
      if (value.enabled === true && current === -1)
        edges.push({
          relation: 'fleet_installs_domain_by_default',
          source: self,
          target: domain.id,
        })
      if (value.enabled === false && current !== -1) edges.splice(current, 1)
      return summary(domain)
    }
    if (method === METHOD('Instance', 'installDomain')) {
      const fleet = edges.find(
        (edge) => edge.relation === 'fleet_contains' && edge.target === self,
      )?.source
      const domain = domains.get(idOf(String(value.domain)))
      if (fleet === undefined || domain === undefined || !catalog(fleet).has(domain.id))
        throw new ResponseError(5000, 'Internal application error.', INVOCATION)
      return { domain: `@${domain.id}`, instance: `@${self}`, origin: domain.origin, ok: true }
    }
    throw new ResponseError(3001, `No callable ${method}.`, INVOCATION)
  }

  const remote = adminSession((target, value) => {
    calls.push({ target, value })
    return invoke(target, value as Readonly<Record<string, unknown>>)
  })

  const query = mock(async (ast: QueryAST) => {
    const plan = ast as unknown as FakeQuery
    let rows = plan.source.terms.flatMap((term) =>
      term.kind === 'path'
        ? [idOf(term.path, core)].filter((id) => nodes.has(id))
        : [...nodes.values()]
            .filter((value) => value.class === ClassKey.of(term.class))
            .map((value) => String(value.id)),
    )
    for (const step of plan.steps) {
      if (step.op === 'expand') {
        rows = rows.flatMap((id) =>
          edges
            .filter(
              (edge) =>
                step.via.some((via) => via.name === edge.relation) &&
                (step.direction === 'outgoing' ? edge.source : edge.target) === id,
            )
            .map((edge) => (step.direction === 'outgoing' ? edge.target : edge.source)),
        )
      } else if (
        step.op === 'filter' &&
        (step.predicate.kind === 'class.satisfies' || step.predicate.kind === 'class.equal')
      ) {
        const key = ClassKey.of(step.predicate.class!)
        rows = rows.filter((id) => nodes.get(id)?.class === key)
      } else throw new Error(`The fake Admin does not evaluate ${JSON.stringify(step)}.`)
    }
    const selected = input.witnesses === true ? rows : [...new Set(rows)]
    return {
      result: {
        kind: 'nodes' as const,
        nodes: selected.map((id) => ({ kind: 'value' as const, value: nodes.get(id)! })),
      },
      page: {},
    }
  })
  const neighbors = mock(async (source: unknown, via: { readonly name: string }) => {
    const found = reached(idOf(String(source), core), [via.name as FakeRelation]).map((id) =>
      nodes.get(id)!,
    )
    return {
      nodes: found,
      first: found[0] ?? null,
      graph: { nodes: found, edges: [] },
      cursor: null,
      collect: async () => ({ nodes: found, cursor: null }),
    }
  })

  return {
    session: remote.session,
    graph: { query, neighbors } as unknown as AdminGraphApi,
    query,
    calls,
    /** The relations as they stand, for assertions after a change. */
    relations: () => edges.map((edge) => [edge.relation, edge.source, edge.target] as const),
  }
}

interface FakeQuery {
  readonly source: {
    readonly terms: ReadonlyArray<
      | { readonly kind: 'path'; readonly path: string }
      | { readonly kind: 'class'; readonly class: (typeof AdminContract.classes)['Fleet'] }
    >
  }
  readonly steps: ReadonlyArray<{
    readonly op: string
    readonly via: ReadonlyArray<{ readonly name: string }>
    readonly direction: 'outgoing' | 'incoming'
    readonly predicate: {
      readonly kind: string
      readonly class?: (typeof AdminContract.classes)['Fleet']
    }
  }>
}

/** `@id` or the core Fleet path, as the node id. */
function idOf(path: string, core?: string): string {
  if (path === AdminContract.fleet.raw) {
    if (core === undefined) throw new Error('The fake Admin has no core Fleet.')
    return core
  }
  return path.startsWith('@') ? path.slice(1) : path
}

function node(id: string, name: 'Fleet' | 'Domain' | 'Instance', props: Record<string, unknown>) {
  return {
    id: NodeId(id),
    class: ClassKey.of(AdminContract.classes[name]),
    props: normalizeProperties(props as Parameters<typeof normalizeProperties>[0]),
  } as Node
}

function domainNode(domain: FakeDomain): Node {
  return node(domain.id, 'Domain', {
    [property.domain.origin]: domain.origin,
    [property.domain.name]: domain.name ?? domain.origin.split('.')[0],
    ...(domain.discoveryUrl === undefined
      ? {}
      : { [property.domain.discoveryUrl]: domain.discoveryUrl }),
    ...(domain.description === undefined
      ? {}
      : { [property.domain.description]: domain.description }),
    [property.domain.createdAt]: AT,
    [property.domain.updatedAt]: AT,
  })
}

function summary(domain: FakeDomain) {
  return {
    id: `@${domain.id}`,
    origin: domain.origin,
    name: domain.name ?? domain.origin.split('.')[0],
    ...(domain.discoveryUrl === undefined ? {} : { discoveryUrl: domain.discoveryUrl }),
    ...(domain.description === undefined ? {} : { description: domain.description }),
    createdAt: AT,
    updatedAt: AT,
  }
}
