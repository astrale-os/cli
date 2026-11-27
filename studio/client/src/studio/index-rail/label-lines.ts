/**
 * An Index entry's name in the lines it reads in, so every entry is told apart at the rail's
 * width, by the rule a card's rule row follows: whole on one line where it fits; else broken
 * between the words of its name (`ownsOrBelongs|ToProject`) on at most three lines, the last
 * ending with "…" when the rest does not fit — never cut in its middle; and where two names
 * would still read alike, each whole on as many lines as it takes.
 */

export type Measure = (text: string) => number

/**
 * A name's words, where it may break: before a capital after a lower-case letter or digit,
 * after `.`, `_`, `-`, `:`, and after a space.
 */
export function nameParts(name: string): string[] {
  return name.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[._:-])(?=.)|(?<=\s)(?=\S)/u).filter(Boolean)
}

/** The parts that fit on one line `room` wide, from the start; always at least one. */
function head(parts: readonly string[], room: number, measure: Measure): number {
  let count = 1
  while (count < parts.length && measure(parts.slice(0, count + 1).join('')) <= room) count += 1
  return count
}

/** A name read on more lines than this ends its last one with "…". */
const MOST_LINES = 3

/** A name's parts, line by line, in lines `room` wide. */
function wrapped(parts: readonly string[], room: number, measure: Measure): string[][] {
  const lines: string[][] = []
  for (let at = 0; at < parts.length;) {
    const count = head(parts.slice(at), room, measure)
    lines.push(parts.slice(at, at + count))
    at += count
  }
  return lines
}

/** A name in at most three lines `room` wide, cut only at its end. */
export function labelLines(name: string, room: number, measure: Measure): string[] {
  if (measure(name) <= room) return [name]
  const lines = wrapped(nameParts(name), room, measure)
  if (lines.length <= MOST_LINES) return lines.map((line) => line.join(''))
  const last = lines.slice(MOST_LINES - 1).flat()
  let kept = 1
  while (kept < last.length && measure(`${last.slice(0, kept + 1).join('')}…`) <= room) kept += 1
  return [
    ...lines.slice(0, MOST_LINES - 1).map((line) => line.join('')),
    `${last.slice(0, kept).join('')}…`,
  ]
}

/** A name whole, in as many lines `room` wide as it takes. */
export function wholeLines(name: string, room: number, measure: Measure): string[] {
  const lines = wrapped(nameParts(name), room, measure).map((line) => line.join(''))
  return lines.length > 0 ? lines : [name]
}

/** Each entry's lines, in the room its row leaves it, no two names reading alike. */
export function linesApart(
  entries: readonly { name: string; room: number }[],
  measure: Measure,
): string[][] {
  const fitted = entries.map(({ name, room }) => labelLines(name, room, measure))
  const readers = new Map<string, Set<string>>()
  fitted.forEach((lines, index) => {
    const key = lines.join('\n')
    readers.set(key, new Set([...(readers.get(key) ?? []), entries[index]!.name]))
  })
  return fitted.map((lines, index) =>
    readers.get(lines.join('\n'))!.size > 1
      ? wholeLines(entries[index]!.name, entries[index]!.room, measure)
      : lines,
  )
}

let context: CanvasRenderingContext2D | null | undefined
const cache = new Map<string, number>()

/** Text measured as `element` renders it, at `size` px in its font. */
export function measureIn(element: Element, size: number): Measure {
  const style = getComputedStyle(element)
  const font = `${style.fontWeight} ${size}px ${style.fontFamily}`
  return (text) => {
    context ??= document.createElement('canvas').getContext('2d')
    if (!context) return text.length * size * 0.56
    const key = `${font}\u0000${text}`
    const known = cache.get(key)
    if (known !== undefined) return known
    context.font = font
    const width = Math.ceil(context.measureText(text).width)
    cache.set(key, width)
    return width
  }
}
