import { readFile } from 'node:fs/promises'

import type { CommandDefinition } from '../../program/index'

import {
  decodeIdentityExport,
  importIdentity,
  isEncryptedIdentityExport,
} from '../../identity/index'
import { fatal, log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/output'
import { readPassphrase } from '../../lib/prompt'

export default {
  name: 'import',
  description: 'Import an identity keypair envelope (auto-detects JWE)',
  arguments: [{ name: 'path', description: 'Envelope file path', required: true }],
  options: [
    {
      flags: '--name <name>',
      description: 'Override identity name (defaults to envelope subject)',
    },
    {
      flags: '--issuer <url>',
      description: 'Default issuer for credentials signed with this imported key',
    },
    {
      flags: '--replace',
      description: 'Replace an existing key-backed identity with the imported keypair',
    },
    ...RAW_OUTPUT_OPTIONS,
  ],
  action: async (
    path: string,
    opts: { name?: string; issuer?: string; replace?: boolean } & RawOutputOpts,
  ) => {
    try {
      const raw = await readFile(path, 'utf-8')
      const passphrase = isEncryptedIdentityExport(raw)
        ? await readPassphrase('Passphrase')
        : undefined
      const envelope = await decodeIdentityExport(raw, passphrase)
      const name = opts.name ?? envelope.subject
      const identity = await importIdentity(envelope, {
        name,
        issuer: opts.issuer,
        replace: opts.replace,
      })

      if (isMachine(opts)) {
        output({ name, ...identity }, opts)
        return
      }
      log.success(
        `Imported identity "${name}" (subject=${identity.subject}, kid=${identity.kid ?? '?'})`,
      )
    } catch (e) {
      fatal(e, opts)
    }
  },
} satisfies CommandDefinition
