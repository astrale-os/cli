import type { CommandDefinition } from '../../program'

import { diffUi } from '../../ui'
import { UI_JSON_OPTION, UI_PROJECT_OPTION, runUiCommand, type UiCommandOptions } from './shared'

type Options = UiCommandOptions & { path?: string }

export default {
  name: 'diff',
  description: 'Compare installed source with the exact locked Astrale UI release',
  arguments: [
    {
      name: 'items',
      description: 'Canonical item addresses; defaults to every locked item',
      required: false,
      variadic: true,
    },
  ],
  options: [
    UI_PROJECT_OPTION,
    { flags: '--path <file>', description: 'Restrict the diff to one installed file' },
    UI_JSON_OPTION,
  ],
  action: async (items: string[], options: Options) =>
    runUiCommand(options, () => diffUi(items, options)),
} satisfies CommandDefinition
