/**
 * Edge terminators.
 *
 * The default reading of the canvas is DIRECTION: nothing where a relationship
 * starts, a slim chevron where it lands. Cardinality is a separate, explicit
 * mode (the canvas "Cardinality" toggle) that spells the declared multiplicity
 * out in words at each end — an arrowhead cannot carry `0..1` vs `1..*` without
 * turning every edge into hieroglyphs.
 *
 * Colour comes from the referencing path for free via SVG `context-stroke`, so
 * one shared <defs> serves muted, cross-module and selected edges alike.
 */

export const EDGE_ARROW = 'edge-arrow'
export const EDGE_DOT = 'edge-dot'

export type EdgeOrientation = 'directed' | 'undirected'

/** Terminators for one relationship: an arrow where it lands, dots when it has no direction. */
export function edgeMarkers(orientation?: EdgeOrientation): {
  markerStart?: string
  markerEnd?: string
} {
  return orientation === 'undirected'
    ? { markerStart: EDGE_DOT, markerEnd: EDGE_DOT }
    : { markerEnd: EDGE_ARROW }
}

/** `{ min, max }` → the SDK's own vocabulary. Undeclared ends are unconstrained. */
export function formatCardinality(cardinality?: { min: number; max: number | null }): string {
  if (!cardinality) return '0..*'
  const { min, max } = cardinality
  if (max === null) return `${min}..*`
  return min === max ? `${max}` : `${min}..${max}`
}

/** A hidden <defs> carrying the shared markers; rendered once inside each canvas. */
export function EdgeMarkerDefs() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute" style={{ position: 'absolute' }}>
      <defs>
        {/* open chevron, tip standing off the node border by 2 units */}
        <marker
          id={EDGE_ARROW}
          viewBox="0 0 16 12"
          refX={13}
          refY={6}
          markerWidth={16}
          markerHeight={12}
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path
            d="M4 2.5 L10.5 6 L4 9.5"
            fill="none"
            stroke="context-stroke"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
        {/* both ends of an undirected relationship */}
        <marker
          id={EDGE_DOT}
          viewBox="0 0 12 12"
          refX={9}
          refY={6}
          markerWidth={12}
          markerHeight={12}
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <circle cx={6} cy={6} r={2.4} fill="context-stroke" stroke="none" />
        </marker>
      </defs>
    </svg>
  )
}
