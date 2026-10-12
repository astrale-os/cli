import { readFile } from 'node:fs/promises'

import type { AstraleConfig } from '../../../lib/config'
import type { ConnectionContext, ConnectionFactory } from '../../session'

import { parseExecutionReceipt } from '../../execution'
import { withResolvedClientSession } from '../../session'

const receipt = parseExecutionReceipt(await readFile(process.argv[2]!, 'utf8'))
const open: ConnectionFactory = (target, _timeout, _options, _config, intent) => {
  return {
    context: {
      target,
      graph: {},
      session: {
        schema: {
          inspect: async () => ({ release: { identity: { issuer: 'https://rotated.example' } } }),
        },
        execution: {
          status: async (id: string) => ({
            target: `${id}.status`,
            principal: intent?.principal,
            issuer: target.domainIssuer,
          }),
        },
      },
    } as unknown as ConnectionContext,
    close() {},
  }
}
const result = await withResolvedClientSession(
  {
    url: receipt.kernel,
    kernelIssuer: receipt.kernel,
  },
  { as: 'alice' },
  {} as AstraleConfig,
  ({ session }) => session.execution.status(receipt.id),
  open,
  { principal: 'execution', receipt },
)
console.log(JSON.stringify(result))
