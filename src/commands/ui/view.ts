import type { CommandDefinition } from '../../program'

import { promptMultiSelect } from '../../lib/prompt'
import { listUi, UiError, viewUi } from '../../ui'
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
    runUiCommand(options, async () => {
      let selected = items
      if (selected.length === 0) {
        if (process.argv.includes('--ci') || process.argv.includes('--no-prompt')) {
          throw new UiError('UI_ITEM_NOT_FOUND', 'No UI item was provided in non-interactive mode.')
        }
        const available = await listUi(undefined, { version: options.version })
        selected =
          (await promptMultiSelect(
            'Choose Astrale UI source to inspect',
            available.map((item) => ({
              name: item.title ?? item.meta.canonicalAddress,
              value: item.meta.canonicalAddress,
              description: item.description,
            })),
          )) ?? []
        if (selected.length === 0) {
          throw new UiError('UI_ITEM_NOT_FOUND', 'No UI item was selected.')
        }
      }
      return viewUi(selected, { version: options.version })
    }),
} satisfies CommandDefinition
