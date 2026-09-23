/**
 * functions.ts — the standalone Functions of a domain, as the studio reads them.
 *
 * A Function is a callable the schema declares on its own: it has an input, an output
 * and a Policy like a Method, but no receiver. That makes it the one schema member with
 * nothing to hang off — so this module answers the two questions every surface asks of
 * it: which Classes it works on (the Definitions its Node-path fields accept), and which
 * Action or Workflow implements it. Pure derivation over the bundle; no I/O.
 */
import type { HandlerLink, IrClassRef, IrFunction, StudioSchemaBundle } from '@shared/types'

import { nodePathAccepts } from '@shared/types'
import { Braces, type LucideIcon, Workflow, Zap } from 'lucide-react'

import { handlerLinkFor } from './method-auth'

export interface FunctionModel {
  name: string
  fn: IrFunction
  /** Every Definition its input or output accepts, deduplicated, in declaration order. */
  refs: IrClassRef[]
  /** Those of `refs` declared by THIS domain — the ones the canvas can draw a line to. */
  boundClasses: string[]
  /** Names no Class at all: it reads or writes nothing the schema points at. */
  standalone: boolean
  /** The Action or Workflow the source overlay resolved for it. */
  link?: HandlerLink
  /** A declared callable whose handler is still a stub. */
  contractOnly: boolean
  /** Where it is declared, for the comment anchor and the source jump. */
  file?: string
  /** The source comment when there is one, else the declared description. */
  doc?: string
}

export interface FunctionsModel {
  all: FunctionModel[]
  /** local class name → the Functions that name it */
  byClass: Map<string, FunctionModel[]>
  /** Functions bound to no local Class */
  standalone: FunctionModel[]
}

const EMPTY: FunctionsModel = { all: [], byClass: new Map(), standalone: [] }

/** Every Definition a callable names, walking the input properties and the output. */
function acceptedRefs(fn: IrFunction): IrClassRef[] {
  const schemas = [
    fn.input,
    ...Object.values(fn.input.properties ?? {}),
    ...(fn.output.mode === 'value' ? [fn.output.schema] : []),
    ...(fn.output.mode === 'stream' ? [fn.output.item] : []),
  ]
  const seen = new Map<string, IrClassRef>()
  for (const schema of schemas) {
    // An array of references carries the path schema on its items, not on itself.
    for (const candidate of [schema, ...(schema.items ? [schema.items] : [])]) {
      for (const ref of nodePathAccepts(candidate)) {
        seen.set(`${ref.origin}:${ref.name}`, ref)
      }
    }
  }
  return [...seen.values()]
}

export function buildFunctionsModel(bundle?: StudioSchemaBundle): FunctionsModel {
  const ir = bundle?.ir
  if (!ir || !bundle) return EMPTY

  const all: FunctionModel[] = Object.entries(ir.functions).map(([name, fn]) => {
    const refs = acceptedRefs(fn)
    const boundClasses = [
      ...new Set(
        refs.filter((ref) => ref.origin === ir.domain && ir.classes[ref.name]).map((r) => r.name),
      ),
    ]
    const link = handlerLinkFor(bundle.overlay.handlerLinks, ir.domain, name, 'function')
    const span = bundle.overlay.sourceSpans[`function.${name}`]
    const doc = span?.doc ?? fn.description
    return {
      name,
      fn,
      refs,
      boundClasses,
      standalone: boundClasses.length === 0,
      ...(link ? { link } : {}),
      contractOnly: link !== undefined && !link.implemented,
      ...(span?.file ? { file: span.file } : {}),
      ...(doc === undefined ? {} : { doc }),
    }
  })

  const byClass = new Map<string, FunctionModel[]>()
  for (const model of all) {
    for (const className of model.boundClasses) {
      const models = byClass.get(className)
      if (models) models.push(model)
      else byClass.set(className, [model])
    }
  }

  return { all, byClass, standalone: all.filter((model) => model.standalone) }
}

export function functionsForClass(model: FunctionsModel, className: string): FunctionModel[] {
  return model.byClass.get(className) ?? []
}

/** The canvas id — and the comment anchor — of a standalone Function. */
export const functionRef = (name: string): string => `function.${name}`

/**
 * How a Function is implemented, in one glyph. Every surface that draws a Function —
 * the canvas pill, the overview row, the detail header, the Process list — reads it
 * from here, so a Workflow never looks like an Action in one place and not another.
 */
export function functionGlyph(model: Pick<FunctionModel, 'link'>): LucideIcon {
  return model.link?.kind === 'workflow' ? Workflow : model.link ? Zap : Braces
}
