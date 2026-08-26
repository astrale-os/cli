import type { CommandDefinition } from '../../program'

import { UI_PRESETS } from '../../ui'
import { UI_JSON_OPTION, runUiCommand, type UiCommandOptions } from './shared'

export default {
  name: 'list',
  description: 'List qualified Astrale UI visual presets',
  options: [UI_JSON_OPTION],
  action: async (options: UiCommandOptions) =>
    runUiCommand(options, async () => UI_PRESETS.map((name) => ({ name }))),
} satisfies CommandDefinition
