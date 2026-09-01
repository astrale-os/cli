import type { CommandDefinition } from '../../program'

import { canPrompt } from '../../lib/interactive'
import { withSpinner } from '../../lib/log'
import { isMachine } from '../../lib/output'
import { promptMultiSelect } from '../../lib/prompt'
import { addUi, listLockedUi, UiError } from '../../ui'
import { UI_JSON_OPTION, UI_PROJECT_OPTION, runUiCommand, type UiCommandOptions } from './shared'

type Options = UiCommandOptions & { dryRun?: boolean; overwrite?: boolean; yes?: boolean }

export default {
  name: 'add',
  description: 'Install consumer-owned Astrale pattern, block, or theme source',
  arguments: [
    {
      name: 'items',
      description: 'Canonical registry addresses or a local exported theme CSS file',
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
    '\nInstalled source belongs to the application. Use theme/<name> for a released theme or ./theme.css for a playground export.\nOrdinary add never overwrites local edits. Run astrale ui doctor before intentionally replacing local source with --overwrite --yes.\n',
  action: async (items: string[], options: Options) =>
    // Two network phases with a question between them, so each gets its own
    // spinner instead of one wrapping the whole operation — an animation
    // running under a prompt fights it for the same lines.
    runUiCommand(options, async () => {
      const spin = !isMachine(options)
      let selected = items
      if (selected.length === 0) {
        if (!canPrompt()) {
          throw new UiError('UI_ITEM_NOT_FOUND', 'No UI item was provided in non-interactive mode.')
        }
        const available = await withSpinner('Loading the Astrale UI catalog', spin, () =>
          listLockedUi(options.project),
        )
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
      const plural = selected.length === 1 ? '' : 's'
      return withSpinner(`Installing ${selected.length} UI item${plural}`, spin, () =>
        addUi(selected, options),
      )
    }),
} satisfies CommandDefinition
