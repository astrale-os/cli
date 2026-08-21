import type {
  StudioSchemaBundle,
  ViewInfo,
  ViewRuntime,
  ViewTargetResult,
} from '../../shared/types'

import { activeInstanceName } from '../instances/active'
import { listViewTargets, viewDefinitionBindings } from './target'

export async function getViewRuntime(
  root: string,
  origin: string,
  view: ViewInfo,
  bundle: StudioSchemaBundle | null,
  timeoutMs: number,
): Promise<ViewRuntime> {
  const instance = await activeInstanceName()
  const targetRequired = viewDefinitionBindings(origin, view, bundle).length > 0
  const targets = targetRequired
    ? instance
      ? await listViewTargets(root, origin, view, bundle, instance, timeoutMs)
      : ({
          status: 'unavailable',
          items: [],
          selected: null,
          stale: null,
          truncated: false,
          reason: 'No active Astrale instance.',
        } satisfies ViewTargetResult)
    : ({
        status: 'available',
        items: [],
        selected: null,
        stale: null,
        truncated: false,
      } satisfies ViewTargetResult)

  return { slug: view.slug, instance, targetRequired, targets }
}
