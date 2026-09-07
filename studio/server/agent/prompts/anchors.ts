/**
 * prompts/anchors.ts — focused anchor descriptions for turn and Ask prompts.
 * The whole-domain schema map is intentionally not embedded in agent turns; the
 * agent reads schema/ directly when it needs broader context.
 */
import type {
  Comment,
  IrClass,
  IrClassKey,
  IrFunction,
  IrMethod,
  JsonSchema,
  SchemaIR,
  SchemaOverlay,
} from '../../../shared/types'

import { isNodePathSchema } from '../../../shared/types'

/** Terse JSON-Schema type label (mirrors the client's format.tsx describe/typeLabel). */
function propType(s: JsonSchema | undefined, optionalOverride?: boolean): string {
  if (!s) return 'any'
  const t = s.type
  const optional = optionalOverride ?? (Array.isArray(t) ? t.includes('null') : false)
  const base = Array.isArray(t) ? t.find((x) => x !== 'null') : t
  let label: string
  if (s.enum) label = `enum(${s.enum.map(String).join('|')})`
  else if (isNodePathSchema(s)) label = '→node'
  else if (base === 'array') label = `${propType(s.items)}[]`
  else if (base === 'object') label = `{${Object.keys(s.properties ?? {}).join(',')}}`
  else if (base === 'integer') label = 'int'
  else if (typeof base === 'string') label = base
  else label = 'any'
  return label + (optional ? '?' : '')
}

function methodSig(name: string, m: IrMethod | IrFunction): string {
  const required = new Set(m.input.required ?? [])
  const params = Object.entries(m.input.properties ?? {})
    .map(([p, s]) => `${p}:${propType(s, !required.has(p))}`)
    .join(', ')
  const output =
    m.output.mode === 'stream'
      ? `stream<${propType(m.output.item)}>`
      : m.output.mode === 'binary'
        ? 'binary'
        : propType(m.output.schema)
  const tags = [
    'static' in m && m.static ? 'static' : '',
    'abstract' in m && m.abstract ? 'abstract' : '',
    m.auth ?? '',
  ].filter(Boolean)
  return `${name}(${params})→${output}${tags.length ? ` [${tags.join(',')}]` : ''}`
}

function classByToken(ir: SchemaIR, token: string): IrClass | undefined {
  const exact = /^(.+):class\.([A-Za-z_$][\w$]*)$/.exec(token)
  if (!exact) return ir.classes[token]
  const [, origin, name] = exact
  if (origin === ir.domain) return ir.classes[name]
  return ir.importedClassesByKey[`${origin}:class.${name}` as IrClassKey]
}

/**
 * A focused, compact description of ONE anchor target — the element the user is
 * asking about. Used to inject context into an Ask side-question prompt. Returns
 * a short block (signature + file:line + doc) or just the location for non-code
 * anchors. Empty string when nothing can be resolved.
 */
export function describeAnchor(
  ref: string,
  ir: SchemaIR | null,
  overlay: SchemaOverlay | undefined,
): string {
  const span = overlay?.sourceSpans[ref]
  const loc = span ? `${span.file}:${span.startLine}` : ''
  const doc = span?.doc ? ` — ${span.doc.replace(/\s+/g, ' ').trim().slice(0, 160)}` : ''

  // class.X.property.y / class.X.method.m
  const member = ref.match(/^class\.(.+)\.(property|method)\.([^.]+)$/)
  if (member && ir) {
    const [, cls, kind, name] = member
    const c = classByToken(ir, cls)
    if (c && kind === 'property' && c.properties?.[name])
      return `**${c.name}.${name}** : ${propType(c.properties[name], c.required ? !c.required.includes(name) : undefined)}${loc ? `  (${loc})` : ''}${doc}`
    if (c && kind === 'method' && c.methods?.[name])
      return `**${c.name}.${name}** — ${methodSig(name, c.methods[name])}${loc ? `  (${loc})` : ''}${doc}`
  }

  // class.X / edge.X (edges live in ir.classes too)
  const cm = ref.match(/^(?:class|edge)\.(.+)$/)
  if (cm && ir) {
    const c = classByToken(ir, cm[1])
    if (c) {
      const L = [`**${c.name}** (${c.type})${loc ? `  (${loc})` : ''}${doc}`]
      const props = Object.entries(c.properties ?? {})
      if (props.length)
        L.push(
          `  props: ${props
            .map(
              ([p, s]) => `${p}:${propType(s, c.required ? !c.required.includes(p) : undefined)}`,
            )
            .join(' · ')}`,
        )
      const ms = Object.entries(c.methods ?? {})
      if (ms.length) L.push(`  methods: ${ms.map(([n, m]) => methodSig(n, m)).join(' · ')}`)
      if (c.type === 'edge' && c.endpoints?.length)
        L.push(
          `  endpoints: ${c.endpoints
            .map(
              (e) =>
                e.refs
                  ?.map((target) => `${target.origin}:${target.kind}.${target.name}`)
                  .join('|') ||
                e.types?.join('|') ||
                e.name,
            )
            .join(' → ')}`,
        )
      return L.join('\n')
    }
  }

  // Standalone canonical Function.
  const fm = ref.match(/^function\.([A-Za-z_$][\w$]*)$/)
  if (fm && ir) {
    const fn = ir.functions?.[fm[1]]
    if (fn)
      return `**${fn.name}** (function) — ${methodSig(fn.name, fn)}${loc ? `  (${loc})` : ''}${doc}`
  }

  // module / section / file / free — not a specific code element
  if (loc) return `\`${ref}\` (${loc})${doc}`
  return ''
}

/** For each thread, resolve its anchor to a concrete code location + the element's own doc. */
export function resolveThreadAnchors(
  threads: Comment[],
  overlay: SchemaOverlay | undefined,
): string {
  const lines: string[] = []
  threads.forEach((c, i) => {
    const a = c.anchorRefs?.[0]
    if (!a) return
    const span = overlay?.sourceSpans[a.ref]
    const loc = span
      ? `${span.file}:${span.startLine}${span.doc ? ` — ${span.doc.replace(/\s+/g, ' ').trim().slice(0, 100)}` : ''}`
      : a.file
        ? a.file
        : '(section / free-text anchor — not a specific code element)'
    lines.push(`  ${i + 1}. \`${a.ref}\` → ${loc}`)
  })
  return lines.length ? `## Where the open threads point\n${lines.join('\n')}` : ''
}
