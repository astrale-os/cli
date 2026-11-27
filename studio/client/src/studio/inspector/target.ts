/**
 * What the Inspector is pointed at: a selection id read against one Domain's bundle. Every
 * lens reads the same target, so a change of lens never re-reads the selection.
 */
import type {
  DefinitionLink,
  HandlerLink,
  IntegrationLink,
  IrCallable,
  IrClass,
  StudioSchemaBundle,
} from '@shared/contracts/schema'
import type { IrClassRef } from '@shared/schema/identity'

import { parseClassRefKey } from '@shared/schema/identity'

import { handlerLinkFor } from '@/lib/callable'
import { viewAnchor } from '@/lib/views'

import { definitionOfTarget, isDefinitionTarget } from '../../schema-studio/definitions'
import { classSelectionId } from '../../schema-studio/detail/model'
import { resolveClass } from '../../schema-studio/inheritance'
import { integrationOfTarget, isIntegrationTarget } from '../../schema-studio/integrations'

export type InspectorTarget =
  | {
      readonly kind: 'class'
      /** the selection id, as the canvas names the Class (`class.X`, `class.<key>`) */
      readonly id: string
      readonly ref: IrClassRef
      /** declared by the Domain on screen */
      readonly local: boolean
      readonly cls: IrClass
    }
  | {
      readonly kind: 'function'
      /** `function.<name>` for a Domain function, `function.<Class>.<method>` for a Method */
      readonly id: string
      /** `Class.method` or the function's name: how handlers and rules key it */
      readonly key: string
      readonly name: string
      /** the Class a Method is declared on; none for a Domain function */
      readonly owner?: string
      readonly callable: IrCallable
      readonly static: boolean
      readonly abstract: boolean
      readonly link?: HandlerLink
    }
  | { readonly kind: 'definition'; readonly id: string; readonly definition: DefinitionLink }
  | { readonly kind: 'integration'; readonly id: string; readonly integration: IntegrationLink }
  | { readonly kind: 'view'; readonly id: string; readonly slug: string }
  /** a selection the bundle names nothing for */
  | { readonly kind: 'missing'; readonly id: string }

/** What every View's anchor starts with: the anchor of no View. */
const VIEW_ANCHOR = viewAnchor('')

/** The selection id of a Method: the one the Behavior canvas draws it under. */
export const methodTarget = (owner: string, method: string) => `function.${owner}.${method}`

/** The selection id of a Domain function or Method by its handler key (`Class.method`, `fn`). */
export const callableTargetOf = (key: string) => `function.${key}`

/**
 * The comment anchor of a target's own row: a Method is commented under its Class
 * (`class.X.method.m`), every other target under its selection id.
 */
export function anchorOf(target: InspectorTarget): string {
  return target.kind === 'function' && target.owner !== undefined
    ? `class.${target.owner}.method.${target.name}`
    : target.id
}

export function targetOf(bundle: StudioSchemaBundle, id: string): InspectorTarget {
  const ir = bundle.ir
  if (ir === null) return { kind: 'missing', id }
  if (id.startsWith('function.')) {
    const key = id.slice('function.'.length)
    const dot = key.indexOf('.')
    if (dot < 0) {
      const callable = ir.functions[key]
      return callable === undefined
        ? { kind: 'missing', id }
        : {
            kind: 'function',
            id,
            key,
            name: key,
            callable,
            static: true,
            abstract: false,
            ...optional(
              'link',
              handlerLinkFor(bundle.overlay.handlerLinks, ir.domain, key, 'function'),
            ),
          }
    }
    const owner = key.slice(0, dot)
    const name = key.slice(dot + 1)
    const method = ir.classes[owner]?.methods[name]
    return method === undefined
      ? { kind: 'missing', id }
      : {
          kind: 'function',
          id,
          key,
          name,
          owner,
          callable: method,
          static: method.static,
          abstract: method.abstract,
          ...optional('link', handlerLinkFor(bundle.overlay.handlerLinks, owner, name, 'class')),
        }
  }
  if (isDefinitionTarget(id)) {
    const definition = definitionOfTarget(bundle, id)
    return definition === undefined
      ? { kind: 'missing', id }
      : { kind: 'definition', id, definition }
  }
  if (isIntegrationTarget(id)) {
    const integration = integrationOfTarget(bundle, id)
    return integration === undefined
      ? { kind: 'missing', id }
      : { kind: 'integration', id, integration }
  }
  if (id.startsWith(VIEW_ANCHOR)) return { kind: 'view', id, slug: id.slice(VIEW_ANCHOR.length) }
  if (id.startsWith('class.') || id.startsWith('edge.')) {
    const token = id.slice(id.indexOf('.') + 1)
    const imported = parseClassRefKey(token)
    const ref: IrClassRef = imported ?? { origin: ir.domain, kind: 'class', name: token }
    const cls = resolveClass(bundle, ref)
    if (cls === undefined) return { kind: 'missing', id }
    return {
      kind: 'class',
      id: classSelectionId(ref, ir.domain),
      ref,
      local: ref.origin === ir.domain,
      cls,
    }
  }
  return { kind: 'missing', id }
}

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
