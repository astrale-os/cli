/**
 * Source-only metadata that the admitted DSL Schema cannot carry.
 */
import type { SchemaIR, SchemaOverlay } from '../../shared/types'

import { buildHandlerLinks, buildSourceSpans } from './overlay-tsmorph'

export interface OverlayArgs {
  ir: SchemaIR | null
  domainRoot: string
  schemaDir: string
}

export function buildOverlay({ ir, domainRoot, schemaDir }: OverlayArgs): SchemaOverlay {
  return {
    handlerLinks: buildHandlerLinks({ ir, domainRoot }),
    sourceSpans: buildSourceSpans({ ir, schemaDir }),
  }
}
