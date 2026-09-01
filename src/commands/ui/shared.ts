import { fatal, withSpinner } from '../../lib/log'
import { isMachine, output } from '../../lib/output'

export type UiCommandOptions = { json?: boolean; project?: string }

/**
 * Run one `ui` operation and print its single value. Pass `label` whenever the
 * operation reaches the npm/GitHub registries — every one of those is seconds
 * of network the user would otherwise wait through with a blank terminal. Omit
 * it when the operation prompts or is purely local: a spinner animating over a
 * question fights it for the same lines.
 */
export async function runUiCommand(
  options: UiCommandOptions,
  operation: () => Promise<unknown>,
  label?: string,
): Promise<void> {
  try {
    const result = label
      ? await withSpinner(label, !isMachine(options), operation)
      : await operation()
    output(result, { json: options.json })
  } catch (error) {
    fatal(error, { json: options.json })
  }
}

export const UI_PROJECT_OPTION = {
  flags: '--project <path>',
  description: 'Existing application root (defaults to the current project)',
} as const

export const UI_JSON_OPTION = {
  flags: '--json',
  description: 'Emit one machine-readable JSON value',
} as const
