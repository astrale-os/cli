import type { DomainInfo } from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'

import { issuer } from '@astrale-os/sdk/auth'
import { mock } from 'bun:test'

import type { ConnectionContext, ConnectionFactory } from '../../../../connection/session'
import type { AstraleConfig } from '../../../../lib/config'

import * as connection from '../../../../connection/index'
import { withResolvedClientSession } from '../../../../connection/session'

// The command reads a real isolated local keypair; only opening the network is replaced.
const kernel = issuer.accept('https://child.example/api')
const installedIssuer = issuer.accept('https://registration.example')
const target = {
  url: kernel,
  kernelIssuer: kernel,
  domainIssuer: issuer.accept('https://shell.example'),
}
const inspected: string[] = []
const principals: unknown[] = []
let effectiveIssuer: string | undefined
const open: ConnectionFactory = (selected, _timeout, _options, _config, credential) => {
  principals.push(credential)
  return {
    context: {
      target: selected,
      session: {
        schema: {
          async inspect(origin: string) {
            inspected.push(origin)
            return { origin, publication: { identity: { issuer: installedIssuer } } } as DomainInfo
          },
        },
      } as unknown as ClientSession,
    } as ConnectionContext,
    close() {},
  }
}

mock.module('../../../../connection/index', () => ({
  ...connection,
  async runKernelCommand(input: Parameters<typeof connection.runKernelCommand>[0]) {
    await withResolvedClientSession(
      target,
      input.opts,
      {} as AstraleConfig,
      async (context) => {
        effectiveIssuer = context.target.domainIssuer
      },
      open,
      input.credential,
    )
  },
}))

const { default: command } = await import('../../register')
const mode = process.argv[2]
await command.action('alice', {
  node: '@existing-user',
  json: true,
  ...(mode === 'direct'
    ? {}
    : {
        via:
          mode === 'kernel'
            ? '/:kernel.astrale.ai:function.register'
            : '/:registration.example:function.registerIdentity',
      }),
  ...(mode === 'explicit' ? { creds: 'explicit-test-credential' } : {}),
})
console.log(JSON.stringify({ effectiveIssuer, inspected, principals }))
