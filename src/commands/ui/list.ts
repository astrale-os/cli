import type { CommandDefinition } from '../../program'

import { listUi } from '../../ui'
import { UI_JSON_OPTION, runUiCommand, type UiCommandOptions } from './shared'

type Options = UiCommandOptions & { type?: string; limit?: string; version?: string }

export default {
  name: 'list',
  description: 'List or search Astrale components, patterns, blocks, and presets',
  arguments: [{ name: 'query', description: 'Optional search text', required: false }],
  options: [
    {
      flags: '--type <type>',
      description: 'Restrict to pattern or block',
      choices: ['pattern', 'block'],
    },
    { flags: '--limit <n>', description: 'Maximum results', default: '100' },
    { flags: '--version <version>', description: 'Exact release to inspect' },
    UI_JSON_OPTION,
  ],
  action: async (query: string | undefined, options: Options) =>
    runUiCommand(options, () =>
      listUi(query, { type: options.type, limit: Number(options.limit), version: options.version }),
    ),
} satisfies CommandDefinition
