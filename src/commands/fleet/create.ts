import type { AdminConnectionOptions } from '../../connection'
import type { OutputOpts } from '../../lib/output'
import type { CommandDefinition } from '../../program/index'

import { createFleet } from '../../admin/fleet/client'
import { withAdminClientSession } from '../../connection'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { randomOperationId } from '../../lib/idempotency'
import { output } from '../../lib/output'

type Options = AdminConnectionOptions &
  OutputOpts & { administrator: string; copyFrom: string; name?: string; operation?: string }
export default {
  name: 'create',
  description: 'Create a Fleet with an independent copy of a source catalogue',
  arguments: [{ name: 'slug', description: 'Unique Fleet slug', required: true }],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    { flags: '--administrator <principal>', description: 'Central Shell User or Group path' },
    { flags: '--copy-from <fleet>', description: 'Source Fleet slug or ID' },
    { flags: '--name <name>', description: 'Display name (defaults to slug)' },
    { flags: '--operation <id>', description: 'Stable creation operation ID for retry' },
  ],
  action: async (slug: string, opts: Options) => {
    if (!opts.administrator || !opts.copyFrom)
      throw new Error('Fleet creation requires --administrator and --copy-from.')
    return output(
      await withAdminClientSession(opts, (context) =>
        createFleet(context, {
          slug,
          name: opts.name ?? slug,
          administrator: opts.administrator,
          copyFrom: opts.copyFrom,
          operationId: opts.operation ?? randomOperationId('cli', 'fleet', 'create'),
        }),
      ),
      opts,
    )
  },
} satisfies CommandDefinition
