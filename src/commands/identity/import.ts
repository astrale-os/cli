import { compactDecrypt, importJWK } from 'jose'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { CommandDefinition } from '../../command'
import type { RegistryMode } from '../../lib/validation'

import { createIdentity, upsertKeyIdentity } from '../../lib/identity'
import { keypairPaths } from '../../lib/keys'
import { fatal, log } from '../../lib/log'
import { readPassphrase } from '../../lib/prompt'

type ExportEnvelope = {
  version?: number
  subject: string
  mode?: RegistryMode
  kid?: string
  issuer?: string
  privateJwk: Record<string, unknown>
  publicJwk: Record<string, unknown>
}

function looksEncrypted(raw: string): boolean {
  // JOSE compact JWE is 5 base64 segments separated by `.`.
  return raw.trim().split('.').length === 5 && !raw.trim().startsWith('{')
}

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
  ],
  action: async (path: string, opts: { name?: string; issuer?: string; replace?: boolean }) => {
    try {
      const raw = await readFile(path, 'utf-8')

      let envelopeJson: string
      if (looksEncrypted(raw)) {
        const passphrase = await readPassphrase('Passphrase: ')
        const { plaintext } = await compactDecrypt(
          raw.trim(),
          new TextEncoder().encode(passphrase),
          {
            keyManagementAlgorithms: ['PBES2-HS256+A128KW'],
          },
        )
        envelopeJson = new TextDecoder().decode(plaintext)
      } else {
        envelopeJson = raw
      }

      const env = JSON.parse(envelopeJson) as ExportEnvelope
      if (!env?.subject || !env?.privateJwk || !env?.publicJwk) {
        fatal(new Error('Invalid envelope: missing subject / privateJwk / publicJwk'))
      }

      // Validate the keypair parses before touching the registry.
      await importJWK(env.privateJwk as never, 'ES256')

      const name = opts.name ?? env.subject
      // Create registry entry (without regenerating keys — we'll write the imported ones).
      if (opts.replace) {
        await upsertKeyIdentity(name, {
          subject: env.subject,
          mode: env.mode ?? 'local',
          issuer: opts.issuer ?? env.issuer,
          kid: env.kid,
        })
      } else {
        await createIdentity(name, {
          subject: env.subject,
          mode: env.mode ?? 'local',
          issuer: opts.issuer ?? env.issuer,
          kid: env.kid,
          skipKeygen: true,
        })
      }
      const { privatePath, publicPath } = keypairPaths(env.subject)
      await mkdir(dirname(privatePath), { recursive: true })
      await writeFile(privatePath, JSON.stringify(env.privateJwk, null, 2), { mode: 0o600 })
      await writeFile(publicPath, JSON.stringify(env.publicJwk, null, 2), { mode: 0o600 })

      log.success(`Imported identity "${name}" (subject=${env.subject}, kid=${env.kid ?? '?'})`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
