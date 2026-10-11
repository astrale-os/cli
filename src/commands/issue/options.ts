import type { CommandDefinition } from '../../program'

import { ADMIN_TARGET_OPTIONS } from '../../lib/admin/target'
import { withKernelOptions } from '../../program/options'

/** Issue commands always target Admin: no direct Kernel URL, no anonymous call. */
const NOT_ADMIN_FLAGS = ['--url <url>', '--anonymous']

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
          : option,
      ),
  }
}
