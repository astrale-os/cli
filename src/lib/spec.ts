/**
 * Shared spec-parsing helpers for compiled domain spec.json files.
 *
 * `extractDomainSlug` / `rawStr` are the node-list variant used by
 * `instance install` and `bootstrap` (returns `undefined` on absence).
 * `domain-identity.ts` deliberately keeps its own whole-spec, throwing
 * `extractDomainSlug(spec)` — a different contract, not consolidated here.
 */

import { BINDING_KEY, parseBinding } from '../kernel/remote-routing'

export { BINDING_KEY }

/** Typed `/:kernel.astrale.ai:class.Domain` — the Domain node's class. */
export const KERNEL_DOMAIN_CLASS = '/:kernel.astrale.ai:class.Domain'

/**
 * Spec `class`/`source`/`target` fields are emitted either as a plain
 * string or a `{ raw }` wrapper. Normalize to the string form.
 */
export function rawStr(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (
    value &&
    typeof value === 'object' &&
    'raw' in value &&
    typeof (value as { raw: unknown }).raw === 'string'
  ) {
    return (value as { raw: string }).raw
  }
  return undefined
}

/**
 * Origin slug of the spec's Domain node: `props.origin`, else the node
 * path minus the leading `/`. `undefined` when the spec carries no Domain
 * node. Mirrors the host admin distribution installer.
 */
export function extractDomainSlug(nodes: unknown[]): string | undefined {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const cls = rawStr((node as { class?: unknown }).class)
    if (cls !== KERNEL_DOMAIN_CLASS && cls !== `${KERNEL_DOMAIN_CLASS}/self`) continue
    const props = (node as { props?: { origin?: unknown } }).props
    const origin = typeof props?.origin === 'string' ? props.origin : undefined
    if (origin) return origin
    const path = (node as { path?: unknown }).path
    if (typeof path === 'string' && path.startsWith('/')) return path.slice(1)
    return undefined
  }
  return undefined
}

/**
 * First `remoteUrl` found across the spec nodes' `Function.binding` prop.
 * For manager-ui this is the single console View
 * (`http://localhost:8844/views/console`). `undefined` when no node
 * carries a binding.
 */
export function findFirstRemoteUrl(nodes: unknown[]): string | undefined {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const props = (node as { props?: Record<string, unknown> }).props
    if (!props) continue
    const binding = parseBinding(props[BINDING_KEY])
    const url = binding?.remoteUrl
    if (typeof url === 'string' && url.length > 0) return url
  }
  return undefined
}
