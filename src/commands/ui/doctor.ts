import type { CommandDefinition } from '../../program'

import { doctorUi } from '../../ui'
import { UI_JSON_OPTION, runUiCommand, type UiCommandOptions } from './shared'

export default {
  name: 'doctor',
  description: 'Verify Astrale UI package, CSS, config, lock, and installed source integrity',
  arguments: [{ name: 'path', description: 'Application directory', required: false }],
  options: [UI_JSON_OPTION],
  action: async (path: string | undefined, options: UiCommandOptions) =>
    runUiCommand(options, () => doctorUi(path)),
} satisfies CommandDefinition
