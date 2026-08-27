#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const TAR_BLOCK_BYTES = 512
const TAR_END_BYTES = TAR_BLOCK_BYTES * 2

function writeText(header, offset, length, value) {
  const encoded = Buffer.from(value)
  if (encoded.length > length) throw new RangeError(`tar field exceeds ${length} bytes`)
  encoded.copy(header, offset)
}

function writeOctal(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, '0') + '\0'
  writeText(header, offset, length, encoded)
}

function tarHeader(name, size, mode) {
  const header = Buffer.alloc(TAR_BLOCK_BYTES)
  writeText(header, 0, 100, name)
  writeOctal(header, 100, 8, mode)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, size)
  writeOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  writeText(header, 156, 1, '0')
  writeText(header, 257, 6, 'ustar\0')
  writeText(header, 263, 2, '00')

  const checksum = [...header].reduce((sum, byte) => sum + byte, 0)
  writeText(header, 148, 8, checksum.toString(8).padStart(6, '0') + '\0 ')
  return header
}

function tarEntry(name, bytes, mode) {
  if (bytes.length === 0) throw new TypeError(`${name} release file must be non-empty`)
  const padding = Buffer.alloc(
    (TAR_BLOCK_BYTES - (bytes.length % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES,
  )
  return Buffer.concat([tarHeader(name, bytes.length, mode), bytes, padding])
}

export function packageReleaseAsset(astrale, cloudflared, cloudflaredLicense) {
  const tar = Buffer.concat([
    tarEntry('astrale', astrale, 0o755),
    tarEntry('astrale-cloudflared', cloudflared, 0o755),
    tarEntry('LICENSE.cloudflared', cloudflaredLicense, 0o644),
    Buffer.alloc(TAR_END_BYTES),
  ])
  const compressed = gzipSync(tar, { level: 9 })
  // gzip metadata must not vary with wall time or the runner operating system.
  compressed.fill(0, 4, 8)
  compressed[9] = 0xff
  return compressed
}

function main() {
  const [astralePath, cloudflaredPath, licensePath, assetPath, ...extra] = process.argv.slice(2)
  if (!astralePath || !cloudflaredPath || !licensePath || !assetPath || extra.length > 0) {
    throw new TypeError(
      'Usage: node scripts/package-release-asset.mjs <astrale> <astrale-cloudflared> <license> <asset.tar.gz>',
    )
  }
  writeFileSync(
    assetPath,
    packageReleaseAsset(
      readFileSync(astralePath),
      readFileSync(cloudflaredPath),
      readFileSync(licensePath),
    ),
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
