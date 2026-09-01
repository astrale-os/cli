import type { CommandDefinition } from '../../program'

import { initUi, type UiPreset } from '../../ui'
import { UI_JSON_OPTION, runUiCommand, type UiCommandOptions } from './shared'

type Options = UiCommandOptions & {
  preset?: UiPreset
  version?: string
  dryRun?: boolean
  force?: boolean
  install?: boolean
}

export default {
  name: 'init',
  description: 'Initialize Astrale UI in an existing React and Tailwind v4 application',
  arguments: [{ name: 'path', description: 'Application directory', required: false }],
  options: [
    {
      flags: '--preset <name>',
      description: 'Visual preset',
      choices: ['astrale', 'compact', 'expressive'],
      default: 'astrale',
    },
    { flags: '--version <version>', description: 'Exact @astrale-os/ui version or release tag' },
    { flags: '--dry-run', description: 'Print the complete plan without writing or installing' },
    { flags: '--force', description: 'Replace an existing Astrale UI lock intentionally' },
    {
      flags: '--no-install',
      description: 'Write configuration without running the package manager',
    },
    UI_JSON_OPTION,
  ],
  afterHelpText:
    '\nExamples:\n  $ astrale ui init --preset astrale\n  $ astrale ui init ./app --dry-run --json\n',
  action: async (path: string | undefined, options: Options) =>
    runUiCommand(options, () => initUi({ path, ...options }), 'Initializing Astrale UI'),
} satisfies CommandDefinition
