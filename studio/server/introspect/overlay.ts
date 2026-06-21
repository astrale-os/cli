/**
 * overlay.ts — the Studio overlay over the DSL IR. Computes what the IR cannot
 * carry. The imports split + requires/postInstall are done here (pure / light
 * static parse). handlerLinks, sourceSpans (+JSDoc) and annotations are filled
 * by a ts-morph pass over schema/*.ts, domain.ts and runtime/index.ts.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  for (const [name, d] of Object.entries(ir?.imports ?? {})) {
    const entry: CrossDomainImport = { name, origin: d.origin, definition: d.definition }
    if (d.origin === 'kernel.astrale.ai') mixins.push(entry)
    else crossDomainImports.push(entry)
  }

  const { requires, postInstall } = parseDomainTs(domainRoot, origin)

  return {
    origin,
    requires,
    crossDomainImports,
    mixins,
    postInstall,
    handlerLinks: buildHandlerLinks({ ir, domainRoot }),
    sourceSpans: buildSourceSpans({ ir, schemaDir }),
    annotations: buildSchemaAnnotations({ ir }),
  }
}

function parseDomainTs(root: string, origin: string): { requires: string[]; postInstall?: string } {
  const f = join(root, 'domain.ts')
  let requires: string[] = []
  let postInstall: string | undefined
  if (existsSync(f)) {
    const src = readFileSync(f, 'utf8')
    const rm = src.match(/requires\s*:\s*\[([^\]]*)\]/)
    if (rm) requires = [...rm[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1])
    const pm = src.match(/postInstall\s*:\s*[`'"]([^`'"]+)[`'"]/)
    if (pm)
      postInstall = pm[1].replace(/\$\{schema\.domain\}/g, origin).replace(/\$\{[^}]+\}/g, origin)
  }
  return { requires, postInstall }
}
