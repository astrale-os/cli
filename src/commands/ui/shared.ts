import { fatal } from '../../lib/log'
import { output } from '../../lib/output'

export type UiCommandOptions = { json?: boolean; project?: string }

export async function runUiCommand(
  options: UiCommandOptions,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    output(await operation(), { json: options.json })
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
