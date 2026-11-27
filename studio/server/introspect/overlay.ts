/**
 * Source-only metadata that the admitted DSL Schema cannot carry.
 */
import type { SchemaIR, SchemaOverlay } from '../../shared/contracts/schema'

import { readDefinitions } from './source-overlay/definitions'
import { flowCache } from './source-overlay/flow'
import { buildHandlerLinks } from './source-overlay/handlers'
import { readIntegrations } from './source-overlay/integrations'
import { newProject } from './source-overlay/project'
import { buildSourceSpans } from './source-overlay/spans'

interface OverlayArgs {
  ir: SchemaIR | null
  domainRoot: string
  schemaDir: string
  /** dependency alias → origin, as the Schema declares them */
  dependencies?: Readonly<Record<string, string>>
}

export function buildOverlay({
  ir,
  domainRoot,
  schemaDir,
  dependencies,
}: OverlayArgs): SchemaOverlay {
  // ONE ts-morph project for every reading. The schema dir lives inside the domain
  // root, so the two filesets overlap almost entirely, and parsing them twice was
  // the most expensive thing a bundle did outside the extractor subprocess.
  const project = newProject()
  // the authored functions each name declares, resolved once for every flow reading
  const cache = flowCache()
  const { definitions, idByDeclaration } = readDefinitions({
    domainRoot,
    project,
    ir,
    ...(dependencies ? { dependencies } : {}),
    cache,
  })
  const integrations = readIntegrations({ domainRoot, project })
  return {
    handlerLinks: buildHandlerLinks({
      ir,
      domainRoot,
      project,
      definitionIds: idByDeclaration,
      integrations,
      cache,
    }),
    definitions,
    integrations,
    sourceSpans: buildSourceSpans({ ir, domainRoot, schemaDir, project }),
  }
}
