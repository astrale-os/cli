import type { ClientSession } from '@astrale-os/kernel-client/session'
import type { Node } from '@astrale-os/sdk/graph/node'
import type { ResolvedClass } from '@astrale-os/sdk/schema'

import { Path } from '@astrale-os/sdk/graph/path'
import { Query } from '@astrale-os/sdk/query'

import {
  bindAdmin,
  invokeAdminMethod,
  requireAdminBinding,
  requireAdminClass,
  requireAdminCore,
  requireAdminProperty,
  type AdminBinding,
} from '../binding'
import { readAllNodes, type AdminGraphApi } from '../graph'
import {
  AdminDomainNotFoundError,
  type DomainInfo,
  type PublishDomainInput,
  type PublishDomainResult,
} from './model'

const ADMIN_ORIGIN = 'admin.astrale.ai'
const PAGE_SIZE = 256
const MAXIMUM_DOMAINS = 10_000
const MAXIMUM_PAGES = Math.ceil(MAXIMUM_DOMAINS / PAGE_SIZE) + 1
const DomainRef = Object.freeze({ origin: ADMIN_ORIGIN, kind: 'class' as const, name: 'Domain' })
const fleetInstallsByDefault = Object.freeze({
  origin: ADMIN_ORIGIN,
  kind: 'class' as const,
  name: 'fleet_installs_domain_by_default',
})

export interface AdminCatalogContext {
  readonly session: ClientSession
  readonly graph: AdminGraphApi
}

export interface AdminCatalogApi {
  list(): Promise<DomainInfo[]>
  require(identifier: string): Promise<DomainInfo>
  publish(input: PublishDomainInput): Promise<PublishDomainResult>
}

export interface AdminCatalogDependencies {
  readonly bind?: (session: ClientSession) => Promise<AdminBinding>
  readonly operationId?: (kind: 'publish' | 'configure-default') => string
}

/** Bind the discovered Admin revision and expose its Domain catalog journey. */
export async function connectAdminCatalog(
  context: AdminCatalogContext,
  dependencies: AdminCatalogDependencies = {},
): Promise<AdminCatalogApi> {
  const binding = requireAdminBinding(await (dependencies.bind ?? bindAdmin)(context.session))
  const Domain = requireAdminClass(binding, 'Domain', 'node')
  const Fleet = requireAdminClass(binding, 'Fleet', 'node')
  const fleet = requireAdminCore(binding, 'fleet')
  const operationId = dependencies.operationId ?? defaultOperationId

  const list = async (): Promise<DomainInfo[]> => {
    const [nodes, defaultsPage] = await Promise.all([
      readAllNodes(
        context.graph,
        Query.from({ kind: 'node', classes: [DomainRef] }).select({
          kind: 'nodes',
          projection: { kind: 'value' },
        }),
        {
          label: 'Admin Domain catalog',
          maximum: MAXIMUM_DOMAINS,
          maximumPages: MAXIMUM_PAGES,
        },
      ),
      context.graph.neighbors(fleet, fleetInstallsByDefault, {
        direction: 'outgoing',
        page: { size: PAGE_SIZE },
      }),
    ])
    const defaults = await defaultsPage.collect({ maximumPages: MAXIMUM_PAGES })
    if (defaults.cursor !== null)
      throw new TypeError('Admin default Domain catalog exceeded its bound.')
    const defaultIds = new Set(defaults.nodes.map((node) => String(node.id)))
    return nodes.map((node) => domainFromNode(Domain, node, defaultIds.has(String(node.id))))
  }

  const requireDomain = async (identifier: string): Promise<DomainInfo> => {
    const found = (await list()).find(
      (domain) =>
        domain.origin === identifier ||
        domain.url === identifier ||
        domain.id === identifier ||
        (domain.id.startsWith('@') && domain.id.slice(1) === identifier),
    )
    if (found === undefined) throw new AdminDomainNotFoundError(identifier)
    return found
  }

  return Object.freeze({
    list,
    require: requireDomain,
    async publish(input: PublishDomainInput): Promise<PublishDomainResult> {
      const existing = (await list()).find((domain) => domain.origin === input.origin)
      const description = input.description ?? existing?.description
      const registryChanged =
        existing === undefined ||
        existing.name !== input.name ||
        existing.url !== input.url ||
        existing.description !== description
      let entry = existing
      if (registryChanged) {
        entry = domainFromSummary(
          await invokeAdminMethod(context.session, binding, Fleet, 'publishDomain', fleet, {
            operationId: operationId('publish'),
            origin: input.origin,
            name: input.name,
            discoveryUrl: input.url,
            ...(description === undefined ? {} : { description }),
          }),
          existing?.installByDefault === true,
        )
      }
      if (entry === undefined) throw new TypeError('Admin Domain publication returned no entry.')

      const defaultChanged =
        input.installByDefault !== undefined &&
        (entry.installByDefault ?? false) !== input.installByDefault
      if (defaultChanged) {
        entry = domainFromSummary(
          await invokeAdminMethod(
            context.session,
            binding,
            Domain,
            'configureDefault',
            Path.parse(entry.id),
            {
              operationId: operationId('configure-default'),
              enabled: input.installByDefault,
            },
          ),
          input.installByDefault === true,
        )
      }
      return Object.freeze({
        entry,
        changed: registryChanged || defaultChanged,
        isNew: existing === undefined,
      })
    },
  })
}

type DynamicDefinition = ResolvedClass<'node'>

function domainFromNode(
  definition: DynamicDefinition,
  node: Node,
  installByDefault: boolean,
): DomainInfo {
  return Object.freeze({
    id: Path.id(node.id).raw,
    origin: requiredProperty(definition, node, 'origin'),
    name: requiredProperty(definition, node, 'name'),
    url: requiredProperty(definition, node, 'discoveryUrl'),
    ...optionalProperty(definition, node, 'description'),
    ...(installByDefault ? { installByDefault: true } : {}),
    createdAt: requiredProperty(definition, node, 'createdAt'),
    updatedAt: requiredProperty(definition, node, 'updatedAt'),
  })
}

function domainFromSummary(input: unknown, installByDefault: boolean): DomainInfo {
  const value = record(input, 'Admin Domain summary')
  return Object.freeze({
    id: requiredString(value.id, 'Admin Domain id'),
    origin: requiredString(value.origin, 'Admin Domain origin'),
    name: requiredString(value.name, 'Admin Domain name'),
    url: requiredString(value.discoveryUrl, 'Admin Domain discovery URL'),
    ...(value.description === undefined
      ? {}
      : { description: requiredString(value.description, 'Admin Domain description') }),
    ...(installByDefault ? { installByDefault: true } : {}),
    createdAt: requiredString(value.createdAt, 'Admin Domain creation time'),
    updatedAt: requiredString(value.updatedAt, 'Admin Domain update time'),
  })
}

function requiredProperty(definition: DynamicDefinition, node: Node, name: string): string {
  return requiredString(
    node.props[requireAdminProperty(definition, name).key],
    `Admin Domain.${name}`,
  )
}

function optionalProperty(
  definition: DynamicDefinition,
  node: Node,
  name: string,
): Readonly<Record<string, string>> {
  const value = node.props[requireAdminProperty(definition, name).key]
  return value === undefined ? {} : { [name]: requiredString(value, `Admin Domain.${name}`) }
}

function requiredString(input: unknown, label: string): string {
  if (typeof input !== 'string' || input.length === 0) throw new TypeError(`${label} is invalid.`)
  return input
}

function record(input: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} is invalid.`)
  }
  return input as Readonly<Record<string, unknown>>
}

function defaultOperationId(kind: 'publish' | 'configure-default'): string {
  return `cli.domain.${kind}:${globalThis.crypto.randomUUID()}`
}
