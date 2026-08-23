/**
 * overlay.ts — the Studio overlay over the DSL IR. Computes what the IR cannot
 * carry. The import split and dependency list are computed here; handlerLinks,
 * static parse). handlerLinks, sourceSpans (+JSDoc) and annotations are filled
 * by a ts-morph pass over current Schema, Runtime, Action, and Workflow files.
 */
import type { CrossDomainImport, SchemaIR, SchemaOverlay } from '../../shared/types'

import { buildHandlerLinks, buildSchemaAnnotations, buildSourceSpans } from './overlay-tsmorph'

export interface OverlayArgs {
  ir: SchemaIR | null
  domainRoot: string
  schemaDir: string
}

export function buildOverlay({ ir, domainRoot, schemaDir }: OverlayArgs): SchemaOverlay {
  const origin = ir?.domain ?? ''
  const mixins: CrossDomainImport[] = []
  const crossDomainImports: CrossDomainImport[] = []
  for (const descriptor of Object.values(ir?.importsByKey ?? {})) {
    const entry: CrossDomainImport = {
      name: descriptor.ref.name,
      origin: descriptor.origin,
      ref: descriptor.ref,
    }
    if (descriptor.origin === 'kernel.astrale.ai') mixins.push(entry)
    else crossDomainImports.push(entry)
  }

  return {
    origin,
    requires: (ir?.dependencies ?? []).map(({ origin }) => origin),
    crossDomainImports,
    mixins,
    handlerLinks: buildHandlerLinks({ ir, domainRoot }),
    sourceSpans: buildSourceSpans({ ir, schemaDir }),
    annotations: buildSchemaAnnotations({ ir }),
  }
}
