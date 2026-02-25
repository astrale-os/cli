import { compileGsl } from '@astrale/typegraph-codegen'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

export interface CodegenResult {
  typesWritten: boolean
  scaffoldWritten: boolean
  nodeCount: number
  edgeCount: number
  methodCount: number
}

export function runCodegen(opts: {
  schemaPath: string
  outputDir: string
  scaffold?: boolean
  scaffoldPath?: string
  scaffoldImportPath?: string
  check?: boolean
}): CodegenResult {
  const source = readFileSync(resolve(opts.schemaPath), 'utf-8')
  const { ir, source: tsSource, scaffold, result } = compileGsl(source)

  const outDir = resolve(opts.outputDir)
  mkdirSync(outDir, { recursive: true })

  const tsPath = join(outDir, 'schema.generated.ts')
  const irPath = join(outDir, 'schema.ir.json')

  // Normalize timestamp for deterministic output
  const irStable = { ...(ir as unknown as Record<string, unknown>) }
  if (irStable.meta && typeof irStable.meta === 'object') {
    irStable.meta = { ...(irStable.meta as Record<string, unknown>), generated_at: '' }
  }
  const irJson = JSON.stringify(irStable, null, 2) + '\n'

  const model = result.model
  const nodeCount = model.nodeDefs.size
  const edgeCount = model.edgeDefs.size
  const methodCount = Array.from(model.nodeDefs.values()).reduce(
    (acc, n) => acc + n.allMethods.length,
    0,
  )

  if (opts.check) {
    const existingTS = existsSync(tsPath) ? readFileSync(tsPath, 'utf-8') : ''
    const existingIR = existsSync(irPath) ? readFileSync(irPath, 'utf-8') : ''
    if (existingTS !== tsSource || existingIR !== irJson) {
      throw new Error('Generated files are stale — run "astrale generate" to update')
    }
    return { typesWritten: false, scaffoldWritten: false, nodeCount, edgeCount, methodCount }
  }

  writeFileSync(tsPath, tsSource, 'utf-8')
  writeFileSync(irPath, irJson, 'utf-8')

  let scaffoldWritten = false
  if (opts.scaffold && scaffold) {
    const scaffPath = resolve(opts.scaffoldPath ?? 'src/methods.ts')
    if (!existsSync(scaffPath)) {
      // Rewrite import path: scaffold defaults to './schema.generated' (sibling),
      // but when scaffold lives in src/ and types live in schema/, fix the import.
      const importPath = opts.scaffoldImportPath ?? '../schema/schema.generated'
      const rewritten = scaffold.replace(/from '\.\/schema\.generated'/g, `from '${importPath}'`)
      mkdirSync(resolve(scaffPath, '..'), { recursive: true })
      writeFileSync(scaffPath, rewritten, 'utf-8')
      scaffoldWritten = true
    }
  }

  return { typesWritten: true, scaffoldWritten, nodeCount, edgeCount, methodCount }
}
