import type { CommandDefinition } from '../../command'

import { readIdpConfigOrBuiltin } from '../../lib/idp'
import { output, RAW_OUTPUT_OPTIONS } from '../../lib/output'

export default {
  name: 'show',
  description: 'Show an identity provider configuration',
  arguments: [{ name: 'name', description: 'Local IdP registry name' }],
  options: [
    { flags: '--format <type>', description: 'Output format', choices: ['yaml', 'json'] },
    ...RAW_OUTPUT_OPTIONS,
  ],
  action: async (
    name: string,
    opts: { raw?: boolean; json?: boolean; format?: 'yaml' | 'json' },
  ) => {
    const idp = await readIdpConfigOrBuiltin(name)
    output(
      {
        name: idp.name,
        entry: idp.entry,
        metadata: idp.metadata,
        client: idp.client,
      },
      opts,
    )
  },
} satisfies CommandDefinition
