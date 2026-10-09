import type { ResolvedView } from '@astrale-os/shell'

import type { withClientSession } from '../../connection'
import type { ViewServeConfig } from './session'

import { AstraleError } from '../../errors'
import { resolveDomainViews, selectedView, viewKeyOrigin } from './resolve'

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
    const current = config.session.view
    const key = String(current.route.key)
    const { candidates } = await resolveDomainViews(context, viewKeyOrigin(key))
    const selected = candidates.find((candidate) => candidate.route.key === current.route.key)
    if (selected === undefined) {
      throw new AstraleError(
        'VIEW_NOT_FOUND',
        'The open View is no longer published by its Domain.',
      )
    }
    return selectedView(selected)
  })
}
