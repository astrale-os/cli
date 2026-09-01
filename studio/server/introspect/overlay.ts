/**
 * Source-only metadata that the admitted DSL Schema cannot carry.
 */
import type { SchemaIR, SchemaOverlay } from '../../shared/types'

import { buildHandlerLinks, buildSourceSpans } from './overlay-tsmorph'
import { newProject } from './source-overlay/project'

export interface OverlayArgs {
  ir: SchemaIR | null
  domainRoot: string
  schemaDir: string
}

export function buildOverlay({ ir, domainRoot, schemaDir }: OverlayArgs): SchemaOverlay {
  // ONE ts-morph project for both readings. The schema dir lives inside the domain
  // root, so the two filesets overlap almost entirely, and parsing them twice was
  // the most expensive thing a bundle did outside the extractor subprocess.
  const project = newProject()
  return {
    handlerLinks: buildHandlerLinks({ ir, domainRoot, project }),
    sourceSpans: buildSourceSpans({ ir, domainRoot, schemaDir, project }),
  }
}
