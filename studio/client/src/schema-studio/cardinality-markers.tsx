import type { ReactNode } from 'react'

// ── Cardinality markers for the schema canvas ──
// Two bold, FILLED terminators — a solid dot = "one", a solid fork = "many" — so a
// typed edge's endpoint multiplicity reads at a glance: a single point vs. a fan that
// splays into many. Filled (not thin line-art) is the whole point: it stays crisp at
// any zoom and merges cleanly where edges converge, instead of the flimsy, interlocking
// look of open rings and hairline tines. Optionality + exact bounds live in the detail
// pane (see detail.tsx), which has room and never competes with the canvas.
//
// Design intent (subtle by default): the vast majority of endpoints are the
// unconstrained default (`0..*`, serialized to `undefined`). Drawing a crow's-foot
// on every one of them is pure noise, so a fully-unconstrained edge keeps its plain
// directional arrow (see graph.tsx). Only edges that DECLARE a real constraint
// (`1`, `0..1`, `1..*`) "light up" with ERD markers at BOTH ends — drawing the eye
// to the handful of relationships where cardinality actually carries information.
//
// Color follows the edge for free via SVG `context-stroke` (the marker inherits the
// referencing path's stroke), so the existing muted / cross-module-orange / selected-
// primary edge semantics — and the focus/dim opacity — apply to the markers too,
// with a single shared <defs> instead of one marker per color.

export type Cardinality = { min: number; max: number | null } | undefined

// Every glyph's leading (node-side) edge sits at x=18, and refX is set a few units
// PAST it (STANDOFF below) so the marker keeps a small gap from the node border
// instead of clipping into it. The glyph trails back toward lower x; the line
// reaches the node behind it. `orient="auto-start-reverse"` lets ONE definition
// serve both ends: as markerEnd it points into the target, as markerStart it flips
// to point into the source.
const LEAD = 18 // node-side edge of every glyph
const STANDOFF = 3 // gap (in marker units) kept between the glyph and the node border
// Two BOLD, FILLED glyphs — built from the same primitive that makes the classic
// arrowhead reliable (one confident solid shape, never thin line-art). Filled shapes
// render crisply at any zoom and MERGE cleanly when several edges converge on one node,
// instead of interlocking the way open rings / hairline tines do.
const MARKERS: { id: string; draw: ReactNode }[] = [
  {
    // many — a solid filled fork (a crow's-foot drawn as ONE shape: apex on the line,
    // a notched base fanning into the entity)
    id: 'erd-many',
    draw: <path d="M6 11 L18 4 L13.5 11 L18 18 Z" fill="context-stroke" stroke="none" />,
  },
  {
    // one — a solid filled dot
    id: 'erd-one',
    draw: <circle cx={15} cy={11} r={2.9} fill="context-stroke" stroke="none" />,
  },
]

/** A hidden <defs> carrying the ERD markers; rendered once inside the canvas.
 *  Marker URLs are document-global, so its position in the tree is irrelevant. */
export function ErdMarkerDefs() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute" style={{ position: 'absolute' }}>
      <defs>
        {MARKERS.map(({ id, draw }) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 24 22"
            refX={LEAD + STANDOFF}
            refY={11}
            markerWidth={24}
            markerHeight={22}
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <g
              fill="none"
              stroke="context-stroke"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {draw}
            </g>
          </marker>
        ))}
      </defs>
    </svg>
  )
}

// Bare marker ids — React Flow wraps a string marker into `url('#<id>')` itself,
// so passing the `url(...)` form double-wraps and renders nothing.
//
// The canvas shows ONE-vs-MANY only — the at-a-glance fact (is this side singular or
// plural?). Optionality (0 vs 1 minimum) and exact bounds live in the detail pane, which
// has room and never has to fight the canvas. `max ≤ 1 ⇒ one`; otherwise many.
function markerFor(c: Cardinality): string {
  if (!c) return 'erd-many' // unconstrained end of a lit edge ⇒ many
  return c.max === null || c.max > 1 ? 'erd-many' : 'erd-one'
}

/** Cardinality markers for a typed edge's two endpoints. EVERY end shows its
 *  multiplicity — `undefined` (unconstrained = `0..*`) reads as many ⇒ a fork — so a
 *  many-to-many edge renders as fork↔fork instead of a directional arrow that would
 *  imply a shape (and a singular-ish direction) the relationship doesn't have. */
export function cardinalityMarkers(
  source: Cardinality,
  target: Cardinality,
): {
  markerStart: string
  markerEnd: string
} {
  return { markerStart: markerFor(source), markerEnd: markerFor(target) }
}
