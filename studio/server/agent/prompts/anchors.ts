/**
 * prompts/anchors.ts — focused anchor descriptions for turn and Ask prompts.
 * The whole-domain schema map is intentionally not embedded in agent turns; the
 * agent reads schema/ directly when it needs broader context.
 */
import type { Comment, IrMethod, JsonSchema, SchemaIR, SchemaOverlay } from '../../../shared/types'

/** Terse JSON-Schema type label (mirrors the client's format.tsx describe/typeLabel). */
function propType(s: JsonSchema | undefined): string {
  if (!s) return 'any'
  const t = s.type
  const optional = Array.isArray(t) ? t.includes('null') : false
  const base = Array.isArray(t) ? t.find((x) => x !== 'null') : t
  let label: string
  if (s.enum) label = `enum(${s.enum.map(String).join('|')})`
  else if (s.$nodeRef) label = '→node'
  else if (s.$dataRef) label = '→data'
  else if (base === 'array') label = `${propType(s.items)}[]`
  else if (base === 'object') label = `{${Object.keys(s.properties ?? {}).join(',')}}`
  else if (base === 'integer') label = 'int'
  else if (typeof base === 'string') label = base
  else label = 'any'
  return label + (optional ? '?' : '')
}

function methodSig(name: string, m: IrMethod): string {
  const params = Object.entries(m.params ?? {})
    .map(([p, s]) => `${p}:${propType(s)}`)
    .join(', ')
  const tags = [m.static ? 'static' : '', m.inheritance === 'abstract' ? 'abstract' : ''].filter(
    Boolean,
  )
  return `${name}(${params})→${propType(m.returns)}${tags.length ? ` [${tags.join(',')}]` : ''}`
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
  const member = ref.match(/^class\.([^.]+)\.(property|method)\.(.+)$/)
  if (member && ir) {
    const [, cls, kind, name] = member
    const c = ir.classes?.[cls]
    if (c && kind === 'property' && c.properties?.[name])
      return `**${cls}.${name}** : ${propType(c.properties[name])}${loc ? `  (${loc})` : ''}${doc}`
    if (c && kind === 'method' && c.methods?.[name])
      return `**${cls}.${name}** — ${methodSig(name, c.methods[name])}${loc ? `  (${loc})` : ''}${doc}`
  }

  // class.X / edge.X (edges live in ir.classes too)
  const cm = ref.match(/^(?:class|edge)\.(.+)$/)
  if (cm && ir) {
    const c = ir.classes?.[cm[1]]
    if (c) {
      const L = [`**${c.name}** (${c.type})${loc ? `  (${loc})` : ''}${doc}`]
      const props = Object.entries(c.properties ?? {})
      if (props.length)
        L.push(`  props: ${props.map(([p, s]) => `${p}:${propType(s)}`).join(' · ')}`)
      const ms = Object.entries(c.methods ?? {})
      if (ms.length) L.push(`  methods: ${ms.map(([n, m]) => methodSig(n, m)).join(' · ')}`)
      if (c.type === 'edge' && c.endpoints?.length)
        L.push(`  endpoints: ${c.endpoints.map((e) => e.types?.join('|') || e.name).join(' → ')}`)
      return L.join('\n')
    }
  }

  // interface.X
  const im = ref.match(/^interface\.(.+)$/)
  if (im && ir) {
    const i = ir.interfaces?.[im[1]]
    if (i) {
      const ms = Object.entries(i.methods ?? {}).map(([n, m]) => methodSig(n, m))
      return `**${i.name}** (interface)${loc ? `  (${loc})` : ''}${doc}${ms.length ? `\n  methods: ${ms.join(' · ')}` : ''}`
    }
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
