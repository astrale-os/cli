/**
 * core-extractor.ts — the Bun-executed island for a domain's CORE (genesis) data.
 * Spawned as a short-lived subprocess by runtime.ts (cwd = domain dir, so the
 * domain's own node_modules resolve @astrale-os/*). It imports the domain's
 * worker-safe `domain.ts`, finds the `defineCore(schema, { nodes, edges })`
 * output wired in as `domain.core`, and prints its resolved nodes/edges as JSON.
 *
 *   bun core-extractor.ts <domainFile> <domainDir>
 *
 * Contract mirrors extractor.ts exactly: NEVER crash. A thrown error prints
 * { ok:false } and exits 0 — the driver treats it as a render state. A domain
 * with no core prints { ok:true, core:null }.
 *
 * NOTE: the `export {}` below marks this as a module so its top-level `domainDir`/
 * `main` are module-scoped (extractor.ts is a sibling script with the same names).
 *
 * className resolution: a core node's `def` is the runtime class-definition
 * object (shape `{ __kind, config }` — it carries NO name field). We resolve the
 * name by identity-matching `def` against the core's own `schema.classes` /
 * `schema.interfaces`, AND every `schema.imports[*]` group — imported kernel
 * classes like `Folder` ONLY resolve via the imports walk. `data` is passed
 * through as the author wrote it in `node(Class, {...})` (most readable form).
 */
export {} // module marker — see header note
import { isAbsolute, resolve } from 'node:path'

const domainDir = process.argv[3] ?? process.cwd()
// the driver passes an absolute path; resolve a relative one against the domain dir
// (a bare relative path would otherwise resolve against THIS script's location).
const rawFile = process.argv[2]
const domainFile = rawFile && !isAbsolute(rawFile) ? resolve(domainDir, rawFile) : rawFile

type AnyRec = Record<string, any>

/** A defineCore() result: flat __nodes/__edges arrays + its schema + domain. */
function looksLikeCore(v: any): boolean {
  return (
    !!v &&
    typeof v === 'object' &&
    Array.isArray(v.__nodes) &&
    Array.isArray(v.__edges) &&
    !!v.schema &&
    typeof v.domain === 'string'
  )
}

/** Find the Core object — wired as `domain.core`, exported directly, or by shape. */
function findCore(mod: AnyRec): any {
  const wired = mod?.domain?.core ?? mod?.default?.core ?? mod?.core
  if (looksLikeCore(wired)) return wired
  // export name varies per domain (GatewayCore / IntegrationCore / …) — scan by shape
  for (const v of Object.values(mod ?? {})) {
    if (looksLikeCore(v)) return v
    if (v && typeof v === 'object' && looksLikeCore((v as AnyRec).core)) return (v as AnyRec).core
  }
  return null
}

/** Build def→className from the schema's own classes/interfaces + imported schemas. */
function classNameMap(schema: AnyRec): Map<any, string> {
  const m = new Map<any, string>()
  const add = (group?: AnyRec) => {
    for (const [name, def] of Object.entries(group ?? {})) if (def && !m.has(def)) m.set(def, name)
  }
  add(schema?.interfaces)
  add(schema?.classes)
  for (const imp of schema?.imports ?? []) {
    add(imp?.interfaces)
    add(imp?.classes)
  }
  return m
}

async function main() {
  if (!domainFile) throw new Error('core-extractor: missing <domainFile>')
  const mod: AnyRec = await import(domainFile)
  const core = findCore(mod)
  if (!core) {
    process.stdout.write(JSON.stringify({ ok: true, core: null }))
    return
  }

  const names = classNameMap(core.schema)
  const nameOf = (def: any): string => names.get(def) ?? def?.config?.name ?? def?.name ?? '?'
  // CorePath is a branded string; nested parents are objects with toString/valueOf,
  // so String() is the correct universal coercion (never JSON.stringify a path).
  const pathStr = (p: any): string => (p == null ? '' : String(p))
  // An edge endpoint is a CorePath OR a SelfMarker ({ type:'core-self', __def }).
  const endpoint = (e: any): string =>
    e && typeof e === 'object' && (e.type === 'core-self' || e.__def)
      ? `self(${nameOf(e.__def)})`
      : pathStr(e)

  const nodes = (core.__nodes ?? []).map((n: AnyRec) => ({
    path: pathStr(n.path),
    className: nameOf(n.def),
    data: n.data ?? {},
    ...(n.parent != null ? { parent: pathStr(n.parent) } : {}),
  }))

  const edges = (core.__edges ?? []).map((e: AnyRec) => ({
    from: endpoint(e.from),
    to: endpoint(e.to),
    edgeName: nameOf(e.edge),
    ...(e.data != null ? { data: e.data } : {}),
  }))

  process.stdout.write(JSON.stringify({ ok: true, core: { domain: core.domain, nodes, edges } }))
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
