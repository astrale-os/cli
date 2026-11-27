import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { Inspector } from '@/studio/inspector/inspector'

/** The selection's page in the side panel: the Inspector, read through the current lens. */
export function SchemaDetail({
  bundle,
  selected,
}: {
  bundle: StudioSchemaBundle
  selected?: string
}) {
  return <Inspector bundle={bundle} selected={selected} />
}
