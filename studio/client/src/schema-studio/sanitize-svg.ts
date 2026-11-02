/**
 * Sanitizes a Domain Class `icon`: raw (lucide-style) SVG markup authored in Domain code, which the
 * Studio injects as HTML. Any Domain, including a third-party one, can author it, so the markup is
 * never passed through: it is tokenized strictly and rebuilt from an allowlist of drawing elements
 * and presentation attributes. Unknown elements are dropped with their content, unknown attributes
 * are dropped, and anything the tokenizer does not understand rejects the whole icon.
 */

const ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
])

const ATTRIBUTES = new Set([
  'viewBox',
  'fill',
  'fill-opacity',
  'fill-rule',
  'clip-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'transform',
  'd',
  'points',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
])

/** Values are plain numbers, colors, keywords or path data: no markup, entities or references. */
const SAFE_VALUE = /^[-+.,#%()\w\s]*$/u
const UNSAFE_VALUE = /url\s*\(|expression\s*\(|script\s*:/iu

const NAME = /^[A-Za-z][-\w:.]*$/u

type Token =
  | {
      readonly kind: 'open'
      readonly name: string
      readonly attributes: string
      readonly closed: boolean
    }
  | { readonly kind: 'close'; readonly name: string }

/** The rebuilt markup, sized to fill its box, or null when the input is not a safe SVG icon. */
export function sanitizeSvg(raw: string): string | null {
  const tokens = tokenize(raw.trim())
  if (tokens === null) return null
  const first = tokens[0]
  if (first?.kind !== 'open' || first.name !== 'svg') return null

  let out = ''
  const stack: string[] = []
  let skipped = 0 // depth inside an element that is dropped with its content
  for (const token of tokens) {
    if (token.kind === 'close') {
      if (stack.pop() !== token.name) return null
      if (skipped > 0) skipped -= 1
      else out += `</${token.name}>`
      continue
    }
    const keep = skipped === 0 && ELEMENTS.has(token.name)
    if (!token.closed) stack.push(token.name)
    if (!keep) {
      if (!token.closed) skipped += 1
      continue
    }
    const attributes = parseAttributes(token.attributes)
    if (attributes === null) return null
    const isRoot = out === ''
    out += `<${token.name}${renderAttributes(attributes, isRoot)}${token.closed ? '/>' : '>'}`
  }
  if (stack.length > 0 || out === '') return null
  return out
}

/** Splits markup into tags, skipping comments, the XML declaration and text. */
function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  let index = 0
  while (index < input.length) {
    // Text between tags (e.g. a <title>) is never copied to the output.
    const start = input.indexOf('<', index)
    if (start === -1) break
    if (input.startsWith('<!--', start)) {
      const end = input.indexOf('-->', start + 4)
      if (end === -1) return null
      index = end + 3
      continue
    }
    if (input.startsWith('<?xml', start)) {
      const end = input.indexOf('?>', start)
      if (end === -1) return null
      index = end + 2
      continue
    }
    const end = tagEnd(input, start)
    if (end === -1) return null
    const body = input.slice(start + 1, end)
    index = end + 1
    if (body.startsWith('/')) {
      const name = body.slice(1).trim()
      if (!NAME.test(name)) return null
      tokens.push({ kind: 'close', name })
      continue
    }
    const closed = body.endsWith('/')
    const inner = closed ? body.slice(0, -1) : body
    const match = /^([A-Za-z][-\w:.]*)(\s[\s\S]*)?$/u.exec(inner)
    if (match === null) return null
    tokens.push({ kind: 'open', name: match[1]!, attributes: match[2] ?? '', closed })
  }
  return tokens
}

/** The index of the `>` closing the tag that opens at `start`, outside quoted attribute values. */
function tagEnd(input: string, start: number): number {
  let quote: string | null = null
  for (let i = start + 1; i < input.length; i += 1) {
    const char = input[i]!
    if (quote !== null) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '<') {
      return -1
    } else if (char === '>') {
      return i
    }
  }
  return -1
}

/** Allowlisted attributes with safe values; null when the attribute list does not parse. */
function parseAttributes(source: string): Map<string, string> | null {
  const attributes = new Map<string, string>()
  const pattern = /\s*([^\s=/"'>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy
  let index = 0
  while (index < source.length) {
    if (source.slice(index).trim() === '') break
    pattern.lastIndex = index
    const match = pattern.exec(source)
    if (match === null) return null // bare or unquoted attributes are not SVG icon markup
    index = pattern.lastIndex
    const name = match[1]!
    const value = match[2] ?? match[3] ?? ''
    if (!ATTRIBUTES.has(name)) continue
    if (!SAFE_VALUE.test(value) || UNSAFE_VALUE.test(value)) continue
    attributes.set(name, value)
  }
  return attributes
}

function renderAttributes(attributes: Map<string, string>, isRoot: boolean): string {
  if (isRoot) {
    // The icon fills its box and inherits the surrounding text color.
    attributes.delete('width')
    attributes.delete('height')
    if (!attributes.has('viewBox')) attributes.set('viewBox', '0 0 24 24')
    attributes.set('xmlns', 'http://www.w3.org/2000/svg')
    attributes.set('width', '100%')
    attributes.set('height', '100%')
    attributes.set('preserveAspectRatio', 'xMidYMid meet')
  }
  let out = ''
  for (const [name, value] of attributes) out += ` ${name}="${value}"`
  return out
}
