/**
 * Query and Mutation definitions, as the Studio selects them, and the callables that
 * use them. Read from the source overlay: a definition is not part of the Schema.
 */
import type { DefinitionLink, HandlerLink, StudioSchemaBundle } from '@shared/contracts/schema'

import { type IrClassRef, parseClassRefKey } from '@shared/schema/identity'

/** `query.<id>` or `mutation.<id>`: the Studio selection of a definition. */
export function definitionTarget(definition: Pick<DefinitionLink, 'kind' | 'id'>): string {
  return `${definition.kind}.${definition.id}`
}

export function definitionOfTarget(
  bundle: StudioSchemaBundle,
  target: string,
): DefinitionLink | undefined {
  return bundle.overlay.definitions.find((definition) => definitionTarget(definition) === target)
}

export function isDefinitionTarget(target: string): boolean {
  return target.startsWith('query.') || target.startsWith('mutation.')
}

/** A Method's key: `Class.method`. */
export function callableKey(owner: string, method: string): string {
  return `${owner}.${method}`
}

/** The key of a handler's callable: `Class.method`, or a Function's name. */
export function callableKeyOf(link: HandlerLink): string {
  return link.ownerKind === 'function' ? link.method : callableKey(link.owner, link.method)
}

/** The callables whose handlers reach each thing `reached` names, by its key, sorted. */
export function reachUsers(
  links: readonly HandlerLink[],
  reached: (link: HandlerLink) => readonly string[] | undefined,
): Map<string, string[]> {
  const users = new Map<string, string[]>()
  for (const link of links) {
    for (const key of reached(link) ?? []) {
      users.set(key, [...(users.get(key) ?? []), callableKeyOf(link)])
    }
  }
  for (const keys of users.values()) keys.sort((left, right) => left.localeCompare(right))
  return users
}

/** An effect's Class: the IR keys a local one by name, another Domain's by its exact key. */
export function effectClass(domain: string, name: string): IrClassRef {
  return parseClassRefKey(name) ?? { origin: domain, kind: 'class', name }
}
