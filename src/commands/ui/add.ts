import type { CommandDefinition } from '../../program'

import { promptMultiSelect } from '../../lib/prompt'
import { addUi, listLockedUi, UiError } from '../../ui'
import { UI_JSON_OPTION, UI_PROJECT_OPTION, runUiCommand, type UiCommandOptions } from './shared'

type Options = UiCommandOptions & { dryRun?: boolean; overwrite?: boolean; yes?: boolean }

export default {
  name: 'add',
  description: 'Install consumer-owned Astrale pattern or block source',
  arguments: [
    {
      name: 'items',
      description: 'Canonical pattern or block addresses',
      required: false,
      variadic: true,
    },
  ],
  options: [
    UI_PROJECT_OPTION,
    { flags: '--dry-run', description: 'Show exact files and dependencies without writing' },
    { flags: '--overwrite', description: 'Allow replacing locally changed installed source' },
    { flags: '--yes', description: 'Confirm the planned operation non-interactively' },
    UI_JSON_OPTION,
  ],
  afterHelpText:
    '\nInstalled source belongs to the application. Ordinary add never overwrites local edits.\nRun astrale ui doctor before intentionally replacing local source with --overwrite --yes.\n',
  action: async (items: string[], options: Options) =>
    runUiCommand(options, async () => {
      let selected = items
      if (selected.length === 0) {
        if (process.argv.includes('--ci') || process.argv.includes('--no-prompt')) {
          throw new UiError('UI_ITEM_NOT_FOUND', 'No UI item was provided in non-interactive mode.')
        }
        const available = await listLockedUi(options.project)
        selected =
          (await promptMultiSelect(
            'Choose Astrale UI source to install',
            available.map((item) => ({
              name: item.title ?? item.meta.canonicalAddress,
              value: item.meta.canonicalAddress,
              description: item.description,
            })),
          )) ?? []
        if (selected.length === 0)
          throw new UiError('UI_ITEM_NOT_FOUND', 'No UI item was selected.')
      }
      return addUi(selected, options)
    }),
} satisfies CommandDefinition
