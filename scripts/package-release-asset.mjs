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

function tarHeader(size) {
  const header = Buffer.alloc(TAR_BLOCK_BYTES)
  writeText(header, 0, 100, 'astrale')
  writeOctal(header, 100, 8, 0o755)
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

export function packageReleaseAsset(binary) {
  if (binary.length === 0) throw new TypeError('release binary must be non-empty')
  const padding = Buffer.alloc(
    (TAR_BLOCK_BYTES - (binary.length % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES,
  )
  const tar = Buffer.concat([
    tarHeader(binary.length),
    binary,
    padding,
    Buffer.alloc(TAR_END_BYTES),
  ])
  const compressed = gzipSync(tar, { level: 9 })
  // gzip metadata must not vary with wall time or the runner operating system.
  compressed.fill(0, 4, 8)
  compressed[9] = 0xff
  return compressed
}

function main() {
  const [binaryPath, assetPath, ...extra] = process.argv.slice(2)
  if (!binaryPath || !assetPath || extra.length > 0) {
    throw new TypeError('Usage: node scripts/package-release-asset.mjs <binary> <asset.tar.gz>')
  }
  writeFileSync(assetPath, packageReleaseAsset(readFileSync(binaryPath)))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
