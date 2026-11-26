/**
 * Query and Mutation definitions, as the Studio selects them, and the callables that
 * use them. Read from the source overlay: a definition is not part of the Schema.
 */
import type { DefinitionLink, HandlerLink, StudioSchemaBundle } from '@shared/contracts/schema'

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

/** The Studio selection a callable key opens: its Class, or the Function itself. */
export function callableTarget(key: string): string {
  const separator = key.lastIndexOf('.')
  return separator > 0 ? `class.${key.slice(0, separator)}` : `function.${key}`
}

/** The callables whose handlers reach each definition, by definition id, sorted. */
export function definitionUsers(links: readonly HandlerLink[]): Map<string, string[]> {
  const users = new Map<string, string[]>()
  for (const link of links) {
    for (const id of link.definitions ?? []) {
      users.set(id, [...(users.get(id) ?? []), callableKeyOf(link)])
    }
  }
  for (const keys of users.values()) keys.sort((left, right) => left.localeCompare(right))
  return users
}
