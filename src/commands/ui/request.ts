import type { CommandDefinition } from '../../program'

import { requestUi } from '../../ui'
import { UI_JSON_OPTION, runUiCommand, type UiCommandOptions } from './shared'

export default {
  name: 'request',
  description: 'Open a public Astrale UI request from free-text intent',
  arguments: [
    { name: 'query', description: 'Desired UI outcome and observable behavior', required: true },
  ],
  options: [UI_JSON_OPTION],
  afterHelpText:
    '\nExamples:\n  $ astrale ui request "accessible async combobox with creation"\n  $ astrale ui request "responsive audit log table" --json\n',
  action: async (query: string, options: UiCommandOptions) =>
    runUiCommand(options, () => requestUi(query, { open: !options.json })),
} satisfies CommandDefinition
