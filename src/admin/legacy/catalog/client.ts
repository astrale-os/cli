/**
 * The Admin Fleet catalog: the `Domain` entries a Fleet contains or lists (origin, name, discovery
 * URL), their publication through `Fleet.publishDomain`, and the Fleet's install-by-default
 * relation set through `Fleet.configureDomainDefault`.
 *
 * @deprecated Successor: the Domain version registry of `../../registry` (a Domain's
 * Publications, read by `astrale domain versions` and `install <origin>@<version>`, written by
 * `astrale-domain publish <environment>`). The Fleet catalog stays the only source of a Fleet's
 * default Domains until catalogue and provisioning by version ship. Short-term consumers: operators
 * who keep a Fleet's defaults (repointing its Shell default with `astrale domain publish --fleet`),
 * and the bare-origin install of `../../../commands/domain/legacy/catalog-install.ts`. Removal
 * (D15): once catalogue and provisioning by version ship and no supported 1Pact SDK installs by
 * bare origin, in a breaking CLI release.
 */
import type { ClientSession } from '@astrale-os/sdk/client/session'
import type { Node } from '@astrale-os/sdk/graph/node'

import { ResponseError } from '@astrale-os/sdk/client'
import { Path } from '@astrale-os/sdk/graph/path'
import { Query } from '@astrale-os/sdk/query'
import { MethodKey, PropertyKey } from '@astrale-os/sdk/schema'

import { randomOperationId } from '../../../lib/idempotency'
import { AdminContract, callAdminMethod } from '../../contract'
import { readAllNodes, type AdminGraphApi } from '../../graph'
import { resolveAdminFleet } from '../../selection'
import { record, requiredNodePath, requiredString } from './decode'
import {
  AdminCatalogOriginConflictError,
  AdminDomainNotFoundError,
  type DomainInfo,
  type PublishDomainInput,
  type PublishDomainResult,
} from './model'

const PAGE_SIZE = 256
const MAXIMUM_DOMAINS = 10_000
const MAXIMUM_PAGES = Math.ceil(MAXIMUM_DOMAINS / PAGE_SIZE) + 1

export interface AdminCatalogContext {
  readonly fleet?: string
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
  if (context.fleet !== undefined) Path.parse(context.fleet)
  const operationId = dependencies.operationId ?? defaultOperationId
  let selected: Promise<Path> | undefined
  const fleet = () => (selected ??= resolveAdminFleet(context))

  const list = async (): Promise<DomainInfo[]> => {
    const observedFleet = await catalogFleet(context, await fleet())
    if (observedFleet === undefined) return []
    const [nodes, defaultsPage] = await Promise.all([
      // A Fleet's catalog is the Domains it contains and the Domains it lists from another Fleet:
      // one Domain per origin, shared by every Fleet that lists it. The Kernel selects each Node
      // once, so a repeat stays a refused anomaly.
      readAllNodes(
        context.graph,
        Query.from({ nodes: [observedFleet] })
          .expand({
            via: [AdminContract.edges.fleetContains, AdminContract.edges.fleetListsDomain],
            direction: 'outgoing',
          })
          .filter({ class: AdminContract.classes.Domain })
          .select({
            kind: 'nodes',
            projection: { kind: 'value' },
          }),
        {
          label: 'Admin Domain catalog',
          maximum: MAXIMUM_DOMAINS,
          maximumPages: MAXIMUM_PAGES,
        },
      ),
      context.graph.neighbors(observedFleet, AdminContract.edges.fleetInstallsDomainByDefault, {
        direction: 'outgoing',
        page: { size: PAGE_SIZE },
      }),
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
        let published
        try {
          published = await callAdminMethod(
            context.session,
            await fleet(),
            MethodKey.of(AdminContract.classes.Fleet, 'publishDomain'),
            {
              operationId: operationId('publish'),
              origin: input.origin,
              name: input.name,
              discoveryUrl: input.url,
              ...(description === undefined ? {} : { description }),
            },
          )
        } catch (error) {
          throw originConflict(error, input.origin, existing !== undefined) ?? error
        }
        entry = domainFromSummary(published, existing?.installByDefault === true)
      }
      if (entry === undefined) throw new TypeError('Admin Domain publication returned no entry.')

      const defaultChanged =
        input.installByDefault !== undefined &&
        (entry.installByDefault ?? false) !== input.installByDefault
      if (defaultChanged) {
        // Defaults are per Fleet: the Fleet names one Domain of its catalog.
        entry = domainFromSummary(
          await callAdminMethod(
            context.session,
            await fleet(),
            MethodKey.of(AdminContract.classes.Fleet, 'configureDomainDefault'),
            {
              operationId: operationId('configure-default'),
              domain: Path.parse(entry.id).raw,
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

/** Default reads use the reserved business key, without traversing protected Kernel namespaces. */
async function catalogFleet(
  context: AdminCatalogContext,
  requested: Path,
): Promise<Path | undefined> {
  if (requested.raw !== AdminContract.fleet.raw) return requested
  const fleets = await readAllNodes(
    context.graph,
    Query.from({ nodes: [AdminContract.classes.Fleet] }).select({
      kind: 'nodes',
      projection: { kind: 'value' },
    }),
    { label: 'Admin Fleets', maximum: 10_000, maximumPages: 40 },
  )
  const slug = PropertyKey.of(AdminContract.classes.Fleet, 'slug')
  if (fleets.some((node) => typeof node.props[slug] !== 'string')) {
    throw new TypeError(
      'Admin Fleet slug migration is required before using the Fleet-scoped catalog.',
    )
  }
  const defaults = fleets.filter((node) => node.props[slug] === 'default')
  if (defaults.length > 1) throw new TypeError('Admin default Fleet is ambiguous.')
  return defaults[0] === undefined ? undefined : Path.id(defaults[0].id)
}

/**
 * Admin's declared `Fleet.publishDomain` refusal: a Fleet other than the core Fleet changes only
 * the Domains it contains, and the core Fleet catalogues an origin only when no Fleet holds it.
 */
function originConflict(
  error: unknown,
  origin: string,
  listed: boolean,
): AdminCatalogOriginConflictError | undefined {
  if (!(error instanceof ResponseError) || error.reason?.code !== 'CATALOG_ORIGIN_CONFLICT')
    return undefined
  const details = error.reason.details
  const reason =
    typeof details === 'object' && details !== null && !Array.isArray(details)
      ? (details as Readonly<Record<string, unknown>>).reason
      : undefined
  return new AdminCatalogOriginConflictError(
    origin,
    reason === 'not-in-fleet' || reason === 'in-another-fleet' ? reason : undefined,
    listed,
    { cause: error },
  )
}

function domainFromNode(node: Node, installByDefault: boolean): DomainInfo {
  // A Domain created in the registry alone has no discovery URL; no catalog installs it.
  const { discoveryUrl } = optionalProperty(node, 'discoveryUrl')
  return Object.freeze({
    id: Path.id(node.id).raw,
    origin: requiredProperty(node, 'origin'),
    name: requiredProperty(node, 'name'),
    ...(discoveryUrl === undefined ? {} : { url: discoveryUrl }),
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
    ...(value.discoveryUrl === undefined
      ? {}
      : { url: requiredString(value.discoveryUrl, 'Admin Domain discovery URL') }),
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

function defaultOperationId(kind: 'publish' | 'configure-default'): string {
  return randomOperationId('cli', 'domain', kind)
}
