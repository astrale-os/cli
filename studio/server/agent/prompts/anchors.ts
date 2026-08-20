/**
 * prompts/anchors.ts — focused anchor descriptions for turn and Ask prompts.
 * The whole-domain schema map is intentionally not embedded in agent turns; the
 * agent reads schema/ directly when it needs broader context.
 */
import type {
  Comment,
  IrDefinitionKey,
  IrFunction,
  IrInterface,
  IrMethod,
  JsonSchema,
  SchemaIR,
  SchemaOverlay,
} from '../../../shared/types'

/** Terse JSON-Schema type label (mirrors the client's format.tsx describe/typeLabel). */
function propType(s: JsonSchema | undefined, optionalOverride?: boolean): string {
  if (!s) return 'any'
  const t = s.type
  const optional = optionalOverride ?? (Array.isArray(t) ? t.includes('null') : false)
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

function methodSig(name: string, m: IrMethod | IrFunction): string {
  const params = Object.entries(m.params ?? {})
    .map(
      ([p, s]) =>
        `${p}:${propType(s, m.requiredParams ? !m.requiredParams.includes(p) : undefined)}`,
    )
    .join(', ')
  const output =
    m.output?.mode === 'stream'
      ? `stream<${propType(m.output.item)}>`
      : m.output?.mode === 'binary'
        ? 'binary'
        : propType(m.output?.mode === 'value' ? m.output.schema : m.returns)
  const tags = [
    m.static ? 'static' : '',
    m.inheritance === 'abstract' ? 'abstract' : '',
    m.auth ?? '',
  ].filter(Boolean)
  return `${name}(${params})→${output}${tags.length ? ` [${tags.join(',')}]` : ''}`
}

function interfaceByToken(ir: SchemaIR, token: string): IrInterface | undefined {
  const exact = /^(.+):interface\.([A-Za-z_$][\w$]*)$/.exec(token)
  if (!exact) return ir.interfaces?.[token]
  const [, origin, name] = exact
  if (origin === ir.domain) return ir.interfaces?.[name]
  return ir.importedInterfacesByKey?.[`${origin}:interface.${name}` as IrDefinitionKey]
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
      return `**${cls}.${name}** : ${propType(c.properties[name], c.required ? !c.required.includes(name) : undefined)}${loc ? `  (${loc})` : ''}${doc}`
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

  // interface.X.property.y / interface.<origin>:interface.X.method.m
  const interfaceMember = ref.match(/^interface\.(.+)\.(property|method)\.([^.]+)$/)
  if (interfaceMember && ir) {
    const [, token, kind, name] = interfaceMember
    const iface = interfaceByToken(ir, token)
    if (iface && kind === 'property' && iface.properties?.[name]) {
      return `**${iface.name}.${name}** : ${propType(iface.properties[name], iface.required ? !iface.required.includes(name) : undefined)}${loc ? `  (${loc})` : ''}${doc}`
    }
    if (iface && kind === 'method' && iface.methods?.[name]) {
      return `**${iface.name}.${name}** — ${methodSig(name, iface.methods[name])}${loc ? `  (${loc})` : ''}${doc}`
    }
  }

  // interface.X or exact interface.<origin>:interface.X
  const im = ref.match(/^interface\.(.+)$/)
  if (im && ir) {
    const i = interfaceByToken(ir, im[1])
    if (i) {
      const props = Object.entries(i.properties ?? {}).map(
        ([name, schema]) =>
          `${name}:${propType(schema, i.required ? !i.required.includes(name) : undefined)}`,
      )
      const ms = Object.entries(i.methods ?? {}).map(([n, m]) => methodSig(n, m))
      return `**${i.name}** (interface)${i.origin && i.origin !== ir.domain ? ` from ${i.origin}` : ''}${loc ? `  (${loc})` : ''}${doc}${props.length ? `\n  props: ${props.join(' · ')}` : ''}${ms.length ? `\n  methods: ${ms.join(' · ')}` : ''}`
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
