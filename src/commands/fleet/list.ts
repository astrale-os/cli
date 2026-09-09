import type { AdminConnectionOptions } from '../../connection'
import type { OutputOpts } from '../../lib/output'
import type { CommandDefinition } from '../../program/index'

import { listFleets } from '../../admin/fleet/client'
import { withAdminClientSession } from '../../connection'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { output } from '../../lib/output'

export default {
  name: 'list',
  description: 'List visible Fleets and effective access',
  options: [...ADMIN_TARGET_OPTIONS],
  action: async (opts: AdminConnectionOptions & OutputOpts) =>
    output(await withAdminClientSession(opts, listFleets), opts),
} satisfies CommandDefinition
