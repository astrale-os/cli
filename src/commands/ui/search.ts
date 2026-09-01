import type { CommandDefinition } from '../../program'

import { searchUi } from '../../ui'
import { UI_JSON_OPTION, UI_PROJECT_OPTION, runUiCommand, type UiCommandOptions } from './shared'

type Options = UiCommandOptions & { limit?: string; offset?: string }

export default {
  name: 'search',
  description: 'Find Astrale UI candidates from free-text intent with exact demo code',
  arguments: [{ name: 'query', description: 'UI intent or exact address', required: true }],
  options: [
    UI_PROJECT_OPTION,
    { flags: '--limit <n>', description: 'Candidates to return (1-10)', default: '5' },
    { flags: '--offset <n>', description: 'Deterministic candidate offset (0-1009)', default: '0' },
    UI_JSON_OPTION,
  ],
  afterHelpText:
    '\nExamples:\n  $ astrale ui search "editable payment table with export"\n  $ astrale ui search "loading button" --limit 5 --json\n',
  action: async (query: string, options: Options) =>
    runUiCommand(
      options,
      () =>
        searchUi(query, {
          project: options.project,
          limit: Number(options.limit),
          offset: Number(options.offset),
        }),
      `Searching Astrale UI for "${query}"`,
    ),
} satisfies CommandDefinition
