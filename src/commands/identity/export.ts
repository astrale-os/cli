import type { CommandDefinition } from '../../program/index'

import { encodeIdentityExport, exportIdentity, writeIdentityExport } from '../../identity/index'
import { fatal, log } from '../../lib/log'
import { readPassphrase } from '../../lib/prompt'

/**
 * Export the per-identity keypair as a plaintext JWK envelope by default.
 * With `--encrypt`, wrap it in a JOSE JWE (PBES2-HS256+A128KW / A256GCM)
 * using a passphrase prompted from the TTY.
 */
export default {
  name: 'export',
  description: 'Export an identity keypair to disk (optional --encrypt)',
  arguments: [
    { name: 'name', description: 'Identity name', required: true },
    { name: 'path', description: 'Output file path', required: true },
  ],
  options: [
    { flags: '--encrypt', description: 'Encrypt the envelope with a passphrase (JOSE JWE)' },
  ],
  action: async (name: string, path: string, opts: { encrypt?: boolean }) => {
    try {
      const envelope = await exportIdentity(name)
      const passphrase = opts.encrypt
        ? await readPassphrase('Passphrase (min 8 chars): ', { minLength: 8 })
        : undefined
      await writeIdentityExport(path, await encodeIdentityExport(envelope, passphrase))

      log.success(`Exported identity "${name}" → ${path}${opts.encrypt ? ' (encrypted)' : ''}`)
      if (!opts.encrypt) {
        log.warn(
          '  Plaintext private JWK — keep this file secure. Use --encrypt for passphrase wrapping.',
        )
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
