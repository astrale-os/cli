import type { ViewInfo, ViewRuntime } from '../../shared/types'

import { activeInstanceName } from '../instances/active'
import { rememberViewPreparation } from './preparation'

interface ViewRuntimeDependencies {
  activeInstance: typeof activeInstanceName
  rememberPreparation: typeof rememberViewPreparation
}

/** Every View belongs to its Domain: preparing one only pins the instance it will read. */
export async function getViewRuntime(
  root: string,
  origin: string,
  view: ViewInfo,
  dependencies: Partial<ViewRuntimeDependencies> = {},
): Promise<ViewRuntime> {
  const instance = await (dependencies.activeInstance ?? activeInstanceName)()
  const preparation = (dependencies.rememberPreparation ?? rememberViewPreparation)({
    root,
    origin,
    slug: view.slug,
    instance,
  })
  return { slug: view.slug, preparationId: preparation.id, instance }
}
