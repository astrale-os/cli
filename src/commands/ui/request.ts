import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program'

import { createPathCall, runKernelCommand } from '../../connection'
import { requestUi, UI_REQUEST_PATH } from '../../ui'

export default {
  name: 'request',
  description: 'Submit a UI need through the authenticated UI Domain',
  arguments: [
    { name: 'query', description: 'Desired UI outcome and observable behavior', required: true },
  ],
  afterHelpText:
    '\nExamples:\n  $ astrale ui request "accessible async combobox with creation"\n  $ astrale ui request "responsive audit log table" --json\n',
  action: (query: string, opts: KernelCommandOpts) =>
    runKernelCommand({
      opts,
      label: 'UI request',
      fn: (context) =>
        requestUi(query, (input) => context.session.call(createPathCall(UI_REQUEST_PATH, input))),
    }),
} satisfies CommandDefinition
