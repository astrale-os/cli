import type {
  DefinitionEffect,
  DefinitionLink,
  HandlerLink,
  IntegrationReplay,
  IrClass,
  IrMethod,
  SourceGap,
  StudioSchemaBundle,
} from '@shared/contracts/schema'
import type { IrClassRef } from '@shared/schema/identity'

import { bundle, classRef, importClass } from '../../../schema-studio/__tests__/fixture'

/**
 * A real Domain's behavior, written compactly: exactly what the Behavior projection reads of
 * its bundle — Classes with their bases, Methods and ends; the file that places each in a
 * module; mutations and queries with their effects; handlers; Integrations — and none of its
 * properties, policies, docs, icons or lines.
 */

/** A Class: `Name` for the Domain's own, `origin:Name` for another Domain's. */
export type ShapeRef = string

export interface ShapeClass {
  /** the file that declares it, which places it in a module */
  file?: string
  extends?: ShapeRef[]
  /** its Methods; `static name` for a static one */
  methods?: string[]
  /** an Edge Class's ends, each accepting the Classes listed */
  ends?: [name: string, accepts: ShapeRef[]][]
}

/** `[kind, Class, verb, details]` */
export type ShapeEffect = [
  kind: DefinitionEffect['kind'],
  className: string,
  verb: string,
  details?: Partial<Pick<DefinitionEffect, 'role' | 'property' | 'from' | 'event' | 'to'>>,
]

export interface ShapeDefinition {
  kind?: 'query'
  name: string
  file: string
  /** its writes; what it only expects or reads is left out */
  effects: ShapeEffect[]
  gaps?: SourceGap[]
}

/** `[owner, method, kind, details]`; the owner of a Domain function is `''`. */
export type ShapeHandler = [
  owner: string,
  method: string,
  kind: HandlerLink['kind'],
  details?: Partial<
    Pick<
      HandlerLink,
      | 'static'
      | 'definitions'
      | 'calls'
      | 'integrations'
      | 'integrationGaps'
      | 'implemented'
      | 'unlinked'
    >
  >,
]

export interface BehaviorShape {
  domain: string
  domainId: string
  classes: Record<string, ShapeClass>
  /** another Domain's Classes the schema names */
  imported: Record<ShapeRef, ShapeClass & { edge?: true }>
  /** Domain function → the file that declares it */
  functions: Record<string, string>
  definitions: Record<string, ShapeDefinition>
  handlers: ShapeHandler[]
  integrations: Record<
    string,
    { id: string; operations?: [name: string, replay: IntegrationReplay[]][] }
  >
}

const method = (name: string, isStatic: boolean): IrMethod => ({
  name,
  input: { type: 'object' },
  output: { mode: 'value', schema: { type: 'null' } },
  static: isStatic,
  abstract: false,
  executable: true,
})

/** The bundle the source reading would report for `shape`. */
export function shapedBundle(shape: BehaviorShape): StudioSchemaBundle {
  const ref = (name: ShapeRef): IrClassRef => {
    const split = name.lastIndexOf(':')
    return split < 0
      ? classRef(shape.domain, name)
      : classRef(name.slice(0, split), name.slice(split + 1))
  }
  const irClass = (name: string, origin: string, input: ShapeClass, edge: boolean): IrClass => {
    const bases = (input.extends ?? []).map(ref)
    return {
      type: input.ends || edge ? 'edge' : 'node',
      name,
      origin,
      ref: classRef(origin, name),
      extends: bases.map((base) => base.name),
      extendsRefs: bases,
      properties: {},
      methods: Object.fromEntries(
        (input.methods ?? []).map((entry) => {
          const name = entry.replace(/^static /, '')
          return [name, method(name, entry !== name)]
        }),
      ),
      ...(input.ends
        ? {
            endpoints: input.ends.map(([end, accepts]) => ({
              name: end,
              types: accepts.map((one) => ref(one).name),
              refs: accepts.map(ref),
            })),
          }
        : {}),
    }
  }
  const value = bundle(
    Object.fromEntries(
      Object.entries(shape.classes).map(([name, input]) => [
        name,
        irClass(name, shape.domain, input, false),
      ]),
    ),
    { domainId: shape.domainId },
  )
  const ir = value.ir!
  ir.domain = shape.domain
  for (const [key, input] of Object.entries(shape.imported)) {
    const imported = ref(key)
    importClass(
      value,
      imported,
      irClass(imported.name, imported.origin, input, input.edge === true),
    )
  }
  for (const name of Object.keys(shape.functions))
    ir.functions[name] = {
      name,
      input: { type: 'object' },
      output: { mode: 'value', schema: { type: 'null' } },
    }

  const span = (file: string) => ({ file, startLine: 1, endLine: 1 })
  const definitions = Object.entries(shape.definitions).map(([id, input]): DefinitionLink => ({
    kind: input.kind ?? 'mutation',
    id,
    name: input.name,
    file: input.file,
    line: 1,
    classes: [...new Set(input.effects.map(([, className]) => className))],
    effects: input.effects.map(([kind, className, verb, details]) => ({
      kind,
      class: className,
      verb,
      file: input.file,
      line: 1,
      ...details,
    })),
    ...(input.gaps ? { gaps: input.gaps } : {}),
  }))
  value.overlay = {
    sourceSpans: Object.fromEntries([
      ...Object.entries(shape.classes)
        .filter(([, input]) => input.file)
        .map(([name, input]) => [`${input.ends ? 'edge' : 'class'}.${name}`, span(input.file!)]),
      ...Object.entries(shape.functions).map(([name, file]) => [`function.${name}`, span(file)]),
    ]),
    definitions,
    handlerLinks: shape.handlers.map(([owner, name, kind, details]) => ({
      owner: owner || shape.domain,
      ownerKind: owner ? 'class' : 'function',
      kind,
      method: name,
      static: !owner,
      implemented: true,
      definitions: [],
      ...details,
    })),
    integrations: Object.entries(shape.integrations).map(([key, input]) => ({
      key,
      id: input.id,
      ...(input.operations
        ? { operations: input.operations.map(([name, replay]) => ({ name, replay })) }
        : {}),
    })),
  }
  return value
}
