import type { WorkspaceDomainProjection } from './projection'

/**
 * Has a reorganize finished landing?
 *
 * It arrives in TWO waves. Clearing the workspace frames re-packs them in the very render
 * that empties them, while the ELK re-layout inside each frame only shows up once the
 * cleared layout query has travelled back through preparation. Framing the canvas on the
 * first wave settles it around the geometry being discarded, so the fit waits until every
 * domain the reorganize actually cleared reports an empty layout.
 *
 * A domain that left the workspace mid-flight is not waited on, and an emptied layout is the
 * only signal read — so a reset the server refused still frees the fit rather than stranding
 * it on a domain that will never report.
 */
export function reorganizeSettled(
  domains: WorkspaceDomainProjection[],
  cleared: string[],
): boolean {
  return domains.every(
    (domain) =>
      !cleared.includes(domain.input.summary.id) ||
      Object.keys(domain.input.layout.positions).length === 0,
  )
}
