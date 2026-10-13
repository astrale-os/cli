import type { CommandDefinition } from '../../program'

import { ADMIN_TARGET_OPTIONS } from '../../lib/admin/target'
import { withKernelOptions } from '../../program/options'

/** Issue commands always target Admin: no direct Kernel URL, no anonymous call. */
const NOT_ADMIN_FLAGS = ['--url <url>', '--anonymous']

/** Issue commands print human text on a terminal; --format selects a structured document. */
const FORMAT_DESCRIPTION = 'Output format (default: human text in TTY, json when piped)'

export function withIssueAdminOptions(
  definition: CommandDefinition,
  { affectedInstance = false } = {},
): CommandDefinition {
  const command = withKernelOptions({
    ...definition,
    options: [...ADMIN_TARGET_OPTIONS, ...(definition.options ?? [])],
  })
  return {
    ...command,
    options: command.options
      ?.filter(
        (option) =>
          !NOT_ADMIN_FLAGS.includes(option.flags) &&
          (affectedInstance || option.flags !== '-i, --instance <name>'),
      )
      .map((option) =>
        option.flags === '-i, --instance <name>'
          ? {
              ...option,
              description: 'Affected instance bookmark (optional; never the destination)',
            }
          : option.flags === '--format <type>'
            ? { ...option, description: FORMAT_DESCRIPTION }
            : option,
      ),
  }
}
