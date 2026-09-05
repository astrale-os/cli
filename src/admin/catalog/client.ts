import type { ClientSession } from '@astrale-os/sdk/client/session'
import type { Node } from '@astrale-os/sdk/graph/node'

import { Path } from '@astrale-os/sdk/graph/path'
import { Query } from '@astrale-os/sdk/query'
import { MethodKey } from '@astrale-os/sdk/schema'

import { randomOperationId } from '../../lib/idempotency'
import { AdminContract, callAdminMethod } from '../contract'
import { readAllNodes, type AdminGraphApi } from '../graph'
import {
  AdminDomainNotFoundError,
  type DomainInfo,
  type PublishDomainInput,
  type PublishDomainResult,
} from './model'

const PAGE_SIZE = 256
const MAXIMUM_DOMAINS = 10_000
const MAXIMUM_PAGES = Math.ceil(MAXIMUM_DOMAINS / PAGE_SIZE) + 1

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
  readonly operationId?: (kind: 'publish' | 'configure-default') => string
}

/** Connect the Domain catalog journey without schema discovery or reflection. */
export async function connectAdminCatalog(
  context: AdminCatalogContext,
  dependencies: AdminCatalogDependencies = {},
): Promise<AdminCatalogApi> {
  const operationId = dependencies.operationId ?? defaultOperationId

  const list = async (): Promise<DomainInfo[]> => {
    const [nodes, defaultsPage] = await Promise.all([
      readAllNodes(
        context.graph,
        Query.from({ nodes: [AdminContract.classes.Domain] }).select({
          kind: 'nodes',
          projection: { kind: 'value' },
        }),
        {
          label: 'Admin Domain catalog',
          maximum: MAXIMUM_DOMAINS,
          maximumPages: MAXIMUM_PAGES,
        },
      ),
      context.graph.neighbors(
        AdminContract.fleet,
        AdminContract.edges.fleetInstallsDomainByDefault,
        {
          direction: 'outgoing',
          page: { size: PAGE_SIZE },
        },
      ),
    ])
    const defaults = await defaultsPage.collect({ maximumPages: MAXIMUM_PAGES })
    if (defaults.cursor !== null)
      throw new TypeError('Admin default Domain catalog exceeded its bound.')
    const defaultIds = new Set(defaults.nodes.map((node) => String(node.id)))
    return nodes.map((node) => domainFromNode(node, defaultIds.has(String(node.id))))
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
          await callAdminMethod(
            context.session,
            AdminContract.fleet,
            MethodKey.of(AdminContract.classes.Fleet, 'publishDomain'),
            {
              operationId: operationId('publish'),
              origin: input.origin,
              name: input.name,
              discoveryUrl: input.url,
              ...(description === undefined ? {} : { description }),
            },
          ),
          existing?.installByDefault === true,
        )
      }
      if (entry === undefined) throw new TypeError('Admin Domain publication returned no entry.')

      const defaultChanged =
        input.installByDefault !== undefined &&
        (entry.installByDefault ?? false) !== input.installByDefault
      if (defaultChanged) {
        entry = domainFromSummary(
          await callAdminMethod(
            context.session,
            Path.parse(entry.id),
            MethodKey.of(AdminContract.classes.Domain, 'configureDefault'),
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

function domainFromNode(node: Node, installByDefault: boolean): DomainInfo {
  return Object.freeze({
    id: Path.id(node.id).raw,
    origin: requiredProperty(node, 'origin'),
    name: requiredProperty(node, 'name'),
    url: requiredProperty(node, 'discoveryUrl'),
    ...optionalProperty(node, 'description'),
    ...(installByDefault ? { installByDefault: true } : {}),
    createdAt: requiredProperty(node, 'createdAt'),
    updatedAt: requiredProperty(node, 'updatedAt'),
  })
}

function domainFromSummary(input: unknown, installByDefault: boolean): DomainInfo {
  const value = record(input, 'Admin Domain summary')
  return Object.freeze({
    id: requiredNodePath(value.id, 'Admin Domain id'),
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

function requiredProperty(node: Node, name: keyof typeof AdminContract.properties.domain): string {
  return requiredString(node.props[AdminContract.properties.domain[name]], `Admin Domain.${name}`)
}

function optionalProperty(
  node: Node,
  name: keyof typeof AdminContract.properties.domain,
): Readonly<Record<string, string>> {
  const value = node.props[AdminContract.properties.domain[name]]
  return value === undefined ? {} : { [name]: requiredString(value, `Admin Domain.${name}`) }
}

function requiredString(input: unknown, label: string): string {
  if (typeof input !== 'string' || input.length === 0) throw new TypeError(`${label} is invalid.`)
  return input
}

function requiredNodePath(input: unknown, label: string): string {
  const value = requiredString(input, label)
  try {
    return Path.parse(value).raw
  } catch {
    throw new TypeError(`${label} is invalid.`)
  }
}

function record(input: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} is invalid.`)
  }
  return input as Readonly<Record<string, unknown>>
}

function defaultOperationId(kind: 'publish' | 'configure-default'): string {
  return randomOperationId('cli', 'domain', kind)
}
