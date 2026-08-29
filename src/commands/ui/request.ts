import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program'

import { createPathCall, runKernelCommand } from '../../connection'
import { requestUi, UI_REQUEST_PATH } from '../../ui'

type RequestDependencies = {
  readonly runKernelCommand: typeof runKernelCommand
}

const defaultDependencies: RequestDependencies = Object.freeze({ runKernelCommand })

export async function requestUiCommand(
  query: string,
  options: KernelCommandOpts,
  dependencies: RequestDependencies = defaultDependencies,
): Promise<void> {
  await dependencies.runKernelCommand({
    opts: options,
    label: 'UI request',
    fn: async (context) =>
      requestUi(query, (input) => context.session.call(createPathCall(UI_REQUEST_PATH, input))),
  })
}

export default {
  name: 'request',
  description: 'Submit a UI need through the authenticated UI Domain',
  arguments: [
    { name: 'query', description: 'Desired UI outcome and observable behavior', required: true },
  ],
  afterHelpText:
    '\nExamples:\n  $ astrale ui request "accessible async combobox with creation"\n  $ astrale ui request "responsive audit log table" --json\n',
  action: async (query: string, options: KernelCommandOpts) => requestUiCommand(query, options),
} satisfies CommandDefinition
