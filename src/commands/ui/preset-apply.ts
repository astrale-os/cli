import type { CommandDefinition } from '../../program'

import { applyPreset, type UiPreset } from '../../ui'
import { UI_JSON_OPTION, UI_PROJECT_OPTION, runUiCommand, type UiCommandOptions } from './shared'

type Options = UiCommandOptions & { dryRun?: boolean }

export default {
  name: 'apply',
  description: 'Change the preset CSS import without rewriting component source',
  arguments: [{ name: 'name', description: 'Preset name' }],
  options: [
    UI_PROJECT_OPTION,
    { flags: '--dry-run', description: 'Show the CSS and lock change without writing' },
    UI_JSON_OPTION,
  ],
  action: async (name: UiPreset, options: Options) =>
    runUiCommand(options, () => applyPreset(name, options)),
} satisfies CommandDefinition
