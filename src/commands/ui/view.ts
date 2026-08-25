import type { CommandDefinition } from '../../program'

import { viewUi } from '../../ui'
import { UI_JSON_OPTION, runUiCommand, type UiCommandOptions } from './shared'

type Options = UiCommandOptions & { version?: string }

export default {
  name: 'view',
  description: 'Show registry item metadata, files, dependencies, and provenance',
  arguments: [{ name: 'items', description: 'Canonical item addresses', variadic: true }],
  options: [
    { flags: '--version <version>', description: 'Exact release to inspect' },
    UI_JSON_OPTION,
  ],
  action: async (items: string[], options: Options) =>
    runUiCommand(options, () => viewUi(items, { version: options.version })),
} satisfies CommandDefinition
