import type {
  StudioSchemaBundle,
  ViewInfo,
  ViewRuntime,
  ViewTargetResult,
} from '../../shared/types'

import { activeInstanceName } from '../instances/active'
import { rememberViewPreparation } from './preparation'
import { listViewTargets, viewDefinitionBindings } from './target'

interface ViewRuntimeDependencies {
  activeInstance: typeof activeInstanceName
  listTargets: typeof listViewTargets
  rememberPreparation: typeof rememberViewPreparation
}

export async function getViewRuntime(
  root: string,
  origin: string,
  view: ViewInfo,
  bundle: StudioSchemaBundle | null,
  timeoutMs: number,
  dependencies: Partial<ViewRuntimeDependencies> = {},
): Promise<ViewRuntime> {
  const instance = await (dependencies.activeInstance ?? activeInstanceName)()
  const targetRequired = viewDefinitionBindings(origin, view, bundle).length > 0
  const targets = targetRequired
    ? instance
      ? await (dependencies.listTargets ?? listViewTargets)(
          root,
          origin,
          view,
          bundle,
          instance,
          timeoutMs,
        )
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

  const preparation = (dependencies.rememberPreparation ?? rememberViewPreparation)({
    root,
    origin,
    slug: view.slug,
    instance,
    targetRequired,
    targets,
  })
  return { slug: view.slug, preparationId: preparation.id, instance, targetRequired, targets }
}
