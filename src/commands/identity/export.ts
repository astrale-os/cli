import { CompactEncrypt } from 'jose'
import { chmod, readFile, writeFile } from 'node:fs/promises'

import type { CommandDefinition } from '../../program/index'

import { keypairPaths } from '../../keys/index'
import { getIdentity } from '../../lib/identity'
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
      const identity = await getIdentity(name)
      const { privatePath, publicPath } = keypairPaths(identity.subject)
      const [privateJwk, publicJwk] = await Promise.all([
        readFile(privatePath, 'utf-8').then(JSON.parse),
        readFile(publicPath, 'utf-8').then(JSON.parse),
      ])
      const envelope = {
        version: 1,
        subject: identity.subject,
        mode: identity.mode ?? 'local',
        kid: identity.kid,
        issuer: identity.issuer,
        privateJwk,
        publicJwk,
      }
      const plain = JSON.stringify(envelope, null, 2)

      if (opts.encrypt) {
        const passphrase = await readPassphrase('Passphrase (min 8 chars): ', { minLength: 8 })
        const enc = await new CompactEncrypt(new TextEncoder().encode(plain))
          .setProtectedHeader({ alg: 'PBES2-HS256+A128KW', enc: 'A256GCM' })
          .encrypt(new TextEncoder().encode(passphrase))
        await writeFile(path, enc)
      } else {
        await writeFile(path, plain)
      }
      await chmod(path, 0o600)

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
