/**
 * functions.ts — the standalone Functions of a domain, as the studio reads them.
 *
 * A Function is a callable the schema declares on its own: it has an input, an output
 * and a Policy like a Method, but no receiver. That makes it the one schema member with
 * nothing to hang off — so this module answers the two questions every surface asks of
 * it: which Classes it works on (the Definitions its Node-path fields accept), and which
 * Action or Workflow implements it. Pure derivation over the bundle; no I/O.
 */
import type { HandlerLink, IrFunction, StudioSchemaBundle } from '@shared/contracts/schema'
import type { IrClassRef } from '@shared/schema/identity'

import { callableOutputSchema, nodePathsIn } from '@shared/contracts/schema'
import { classRefKey } from '@shared/schema/identity'

import { handlerLinkFor } from './callable'

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

/** Every Definition a callable names, in its input, then in its output. */
function acceptedRefs(fn: IrFunction): IrClassRef[] {
  const refs = [...nodePathsIn(fn.input), ...nodePathsIn(callableOutputSchema(fn))]
  return [...new Map(refs.map((ref) => [classRefKey(ref), ref])).values()]
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
