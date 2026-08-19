/**
 * extractor.ts — the Bun-executed island. Spawned as a short-lived subprocess by
 * runtime.ts. It imports ONLY the domain's pure `schema/index.ts` module graph
 * (never astrale.config.ts or domain.ts → deps → integrations), reads the
 * compiled `D.$.ir`, and prints the SchemaIR as JSON to stdout.
 *
 *   bun extractor.ts <schemaIndexPath> <domainDir>
 *
 * `compileDomain`/`serialize` are PURE (no IO, no env), so importing the schema
 * is side-effect-free. A thrown error prints { ok:false } and exits 0 — the
 * driver treats it as a render state, never a crash.
 */
const schemaPath = process.argv[2]
const domainDir = process.argv[3] ?? process.cwd()

async function main() {
  if (!schemaPath) throw new Error('extractor: missing <schemaIndexPath>')
  const mod: Record<string, any> = await import(schemaPath)

  // Lazily resolve the domain's own kernel-dsl serializer (used by the fallback
  // path AND to recover imported-interface bodies). Cached after first load.
  let dsl: Record<string, any> | null = null
  const loadDsl = async (): Promise<Record<string, any>> => {
    if (dsl) return dsl
    const loaded: Record<string, any> = await import(
      Bun.resolveSync('@astrale-os/sdk/schema', domainDir)
    )
    dsl = loaded
    return loaded
  }

  // Prefer the conventional `D` (compiled), but accept a compiled domain exported
  // under ANY name — e.g. ai-gateway exports its `compileDomain(...)` result as
  // `Gateway`, not `D`. A compiled domain is recognized by shape (`.$.ir`).
  let ir: unknown = mod?.D?.$?.ir
  if (!ir) {
    for (const v of Object.values(mod)) {
      const candidate = (v as any)?.$?.ir
      if (candidate) {
        ir = candidate
        break
      }
    }
  }
  if (!ir) {
    // Fallback: serialize a raw schema — the conventional `schema`, else any
    // exported `defineSchema(...)` result (recognized by its `kind === 'schema'`).
    const schema =
      mod?.schema ??
      Object.values(mod).find(
        (v) =>
          typeof (v as any)?.domain === 'string' && !!(v as any)?.classes && !!(v as any)?.imports,
      )
    if (!schema) {
      throw new Error(
        'schema entry exports no compiled domain (a `compileDomain(...)` value with `.$.ir`, e.g. `D`) nor a raw `schema`',
      )
    }
    const d = await loadDsl()
    if (typeof d.serialize !== 'function') throw new Error('kernel-dsl.serialize unavailable')
    ir = d.serialize(schema)
  }

  // Recover member bodies of IMPORTED interfaces (kernel mixins + cross-domain
  // interfaces). `serialize()` emits them in `ir.imports` as name-only
  // descriptors, so re-serialize each imported schema (KernelSchema, other
  // domains) and collect its interface definitions. Best-effort: a single import
  // failing to serialize must never break extraction of the primary IR.
  const importedInterfaces: Record<string, unknown> = {}
  const importSchemas: any[] = Array.isArray(mod?.schema?.imports) ? mod.schema.imports : []
  if (importSchemas.length > 0) {
    try {
      const d = await loadDsl()
      if (typeof d.serialize === 'function') {
        for (const imp of importSchemas) {
          try {
            const sub = d.serialize(imp)
            for (const [name, def] of Object.entries(sub?.interfaces ?? {})) {
              if (!(name in importedInterfaces)) importedInterfaces[name] = def
            }
          } catch {
            /* skip this import — keep going */
          }
        }
      }
    } catch {
      /* dsl unavailable — degrade gracefully (no imported-interface bodies) */
    }
  }

  process.stdout.write(JSON.stringify({ ok: true, ir, importedInterfaces }))
}

main().catch((err: any) => {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: { message: String(err?.message ?? err), stack: String(err?.stack ?? '') },
    }),
  )
  process.exit(0)
})
