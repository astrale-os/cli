import chalk from 'chalk'

import type { ListOpts, ListProjection } from '../../lib/output'
import type { CommandDefinition } from '../../program/index'

import { readIdentities } from '../../identity/index'
import { log } from '../../lib/log'
import { isMachine, presentList, RAW_OUTPUT_OPTIONS } from '../../lib/output'

type IdentityRow = {
  name: string
  subject: string
  source: string
  idp?: string
  default: boolean
  createdAt?: string
}

function projection(items: IdentityRow[]): ListProjection {
  return {
    columns: [
      { key: 'name', header: 'NAME', color: chalk.bold },
      { key: 'subject', header: 'SUBJECT', color: chalk.dim },
      { key: 'source', header: 'SOURCE', color: chalk.dim },
    ],
    rows: items.map((i) => ({
      name: i.default ? `${i.name} ${chalk.green('*')}` : i.name,
      subject: i.subject !== i.name ? i.subject : '',
      source: i.source === 'idp' ? `idp:${i.idp ?? '?'}` : 'key',
    })),
    paths: items.map((i) => i.name),
  }
}

export default {
  name: 'list',
  description: 'List all identities',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: ListOpts) => {
    const store = await readIdentities()
    const items: IdentityRow[] = Object.entries(store.identities).map(([name, id]) => ({
      name,
      subject: id.subject,
      source: id.source ?? 'key',
      idp: id.idp,
      default: name === store.default,
      createdAt: id.createdAt,
    }))

    if (items.length === 0 && !isMachine(opts)) {
      log.dim('  No identities. Run: astrale identity create <name>')
      return
    }
    presentList(items, opts, projection)
  },
} satisfies CommandDefinition
