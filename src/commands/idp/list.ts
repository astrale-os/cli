import chalk from 'chalk'

import type { ListOpts, ListProjection } from '../../lib/output'
import type { CommandDefinition } from '../../program/index'

import { listIdpConfigs } from '../../lib/idp'
import { log } from '../../lib/log'
import { isMachine, presentList, RAW_OUTPUT_OPTIONS } from '../../lib/output'

type IdpRow = {
  name: string
  issuer: string
  clientId?: string
  scope?: string
  builtIn: boolean
  updatedAt?: string
}

function projection(items: IdpRow[]): ListProjection {
  return {
    columns: [
      { key: 'name', header: 'NAME', color: chalk.bold },
      { key: 'type', header: 'TYPE', color: chalk.dim },
      { key: 'issuer', header: 'ISSUER', color: chalk.dim },
      { key: 'clientId', header: 'CLIENT_ID', color: chalk.dim },
    ],
    rows: items.map((i) => ({
      name: i.name,
      type: i.builtIn ? 'built-in' : 'custom',
      issuer: i.issuer ?? '',
      clientId: i.clientId ?? '',
    })),
    paths: items.map((i) => i.name),
  }
}

export default {
  name: 'list',
  description: 'List configured identity providers',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: ListOpts) => {
    const items: IdpRow[] = (await listIdpConfigs()).map((config) => ({
      name: config.name,
      issuer: config.entry.issuer,
      clientId: config.client.client_id,
      scope: config.client.scope,
      builtIn: !!config.entry.builtIn,
      updatedAt: config.entry.updatedAt,
    }))

    if (items.length === 0 && !isMachine(opts)) {
      log.dim('  No IdPs. Run: astrale idp add <name> --issuer <url>')
      return
    }
    presentList(items, opts, projection)
  },
} satisfies CommandDefinition
