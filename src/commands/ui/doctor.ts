import type { CommandDefinition } from '../../program'

import { doctorUi, UiError } from '../../ui'
import { UI_JSON_OPTION, UI_PROJECT_OPTION, runUiCommand, type UiCommandOptions } from './shared'

export default {
  name: 'doctor',
  description: 'Verify Astrale UI package, CSS, config, lock, and installed source integrity',
  arguments: [{ name: 'path', description: 'Application directory', required: false }],
  options: [UI_PROJECT_OPTION, UI_JSON_OPTION],
  action: async (path: string | undefined, options: UiCommandOptions) =>
    runUiCommand(
      options,
      () => {
        if (path && options.project) {
          throw new UiError(
            'UI_ITEM_CONFLICT',
            'Choose either the positional application path or --project, not both.',
          )
        }
        return doctorUi(options.project ?? path)
      },
      'Checking installed Astrale UI',
    ),
} satisfies CommandDefinition
