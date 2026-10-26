import type { ResolvedView } from '@astrale-os/shell'

import type { ConnectionContext, withClientSession } from '../../connection'
import type { ViewServeConfig } from './session'

import { AstraleError } from '../../errors'
import { resolveDomainCatalog, selectedView, viewKeyOrigin } from './resolve'

/** Re-resolve the same View in its Domain catalog using this session's retained Kernel authority. */
export function refreshViewPlacement(
  config: ViewServeConfig,
  connect: typeof withClientSession,
): Promise<ResolvedView> {
  return connect(config.kernel, async (context) => {
    if (
      context.target.kernelIssuer !== config.proxy.issuer ||
      context.target.url !== config.proxy.kernelUrl
    ) {
      throw new AstraleError(
        'VIEW_TARGET_CHANGED',
        'The session bookmark now points to another Kernel. Open a new View.',
      )
    }
    return reresolveView(context, config.session.view)
  })
}

/** The placement the Domain catalog publishes now for the same View, read through `context`. */
export async function reresolveView(
  context: Pick<ConnectionContext, 'session'>,
  current: ResolvedView,
): Promise<ResolvedView> {
  const key = String(current.route.key)
  const { candidates } = await resolveDomainCatalog(context, viewKeyOrigin(key))
  const selected = candidates.find((candidate) => candidate.route.key === current.route.key)
  if (selected === undefined) {
    throw new AstraleError('VIEW_NOT_FOUND', 'The open View is no longer published by its Domain.')
  }
  return selectedView(selected)
}
