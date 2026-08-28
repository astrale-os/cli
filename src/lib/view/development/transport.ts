import type { ResolvedView, ViewTransport } from '@astrale-os/shell'

/**
 * Reuse a proven development origin only for Views resolved from the same
 * exact Publication. Foreign or changed placements retain their public href.
 */
export function developmentTransportFor(
  view: ResolvedView,
  witness: ViewTransport | undefined,
): ViewTransport | undefined {
  if (
    witness === undefined ||
    witness.issuer !== view.route.issuer ||
    witness.revision !== view.route.revision ||
    witness.etag !== view.route.etag
  ) {
    return undefined
  }
  const publicDocument = new URL(view.route.href)
  const localOrigin = new URL(witness.href).origin
  return Object.freeze({
    ...witness,
    href: new URL(
      `${publicDocument.pathname}${publicDocument.search}${publicDocument.hash}`,
      localOrigin,
    ).href,
  })
}
