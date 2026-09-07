import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const packer = fileURLToPath(new URL('./package-release-asset.mjs', import.meta.url))

function tarNumber(header, offset, length) {
  return Number.parseInt(
    header
      .subarray(offset, offset + length)
      .toString('ascii')
      .replace(/\0.*$/u, ''),
    8,
  )
}

test('release archive is byte-reproducible and carries the exact toolchain closure', () => {
  const root = mkdtempSync(join(tmpdir(), 'astrale-release-archive-'))
  try {
    const binaryPath = join(root, 'astrale')
    const firstPath = join(root, 'first.tar.gz')
    const secondPath = join(root, 'second.tar.gz')
    const binary = Buffer.from('exact compiled binary bytes\n')
    writeFileSync(binaryPath, binary, { mode: 0o755 })

    const first = spawnSync(process.execPath, [packer, binaryPath, firstPath], { encoding: 'utf8' })
    assert.equal(first.status, 0, first.stderr)

    chmodSync(binaryPath, 0o644)
    utimesSync(binaryPath, new Date('2037-01-02T03:04:05Z'), new Date('2037-01-02T03:04:05Z'))
    const second = spawnSync(process.execPath, [packer, binaryPath, secondPath], {
      encoding: 'utf8',
    })
    assert.equal(second.status, 0, second.stderr)

    const compressed = readFileSync(firstPath)
    assert.deepEqual(readFileSync(secondPath), compressed)
    assert.deepEqual(compressed.subarray(4, 8), Buffer.alloc(4))
    assert.equal(compressed[9], 0xff)

    const archive = gunzipSync(compressed)
    const firstHeader = archive.subarray(0, 512)
    assert.equal(firstHeader.subarray(0, 100).toString('ascii').replace(/\0.*$/u, ''), 'astrale')
    assert.equal(tarNumber(firstHeader, 100, 8), 0o755)
    assert.equal(tarNumber(firstHeader, 108, 8), 0)
    assert.equal(tarNumber(firstHeader, 116, 8), 0)
    assert.equal(tarNumber(firstHeader, 124, 12), binary.length)
    assert.equal(tarNumber(firstHeader, 136, 12), 0)
    assert.equal(firstHeader.subarray(257, 263).toString('ascii'), 'ustar\0')
    assert.deepEqual(archive.subarray(512, 512 + binary.length), binary)

    const listed = spawnSync('tar', ['-tzf', firstPath], { encoding: 'utf8' })
    assert.equal(listed.status, 0, listed.stderr)
    assert.equal(listed.stdout, 'astrale\n')

    const extracted = join(root, 'extracted')
    mkdirSync(extracted)
    const unpacked = spawnSync('tar', ['-xzf', firstPath, '-C', extracted], { encoding: 'utf8' })
    assert.equal(unpacked.status, 0, unpacked.stderr)
    assert.deepEqual(readFileSync(join(extracted, 'astrale')), binary)
    assert.equal(statSync(join(extracted, 'astrale')).mode & 0o777, 0o755)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release archive rejects an empty executable without creating an asset', () => {
  const root = mkdtempSync(join(tmpdir(), 'astrale-release-archive-empty-'))
  try {
    const binaryPath = join(root, 'astrale')
    const assetPath = join(root, 'astrale.tar.gz')
    writeFileSync(binaryPath, '')

    const packed = spawnSync(process.execPath, [packer, binaryPath, assetPath], {
      encoding: 'utf8',
    })
    assert.notEqual(packed.status, 0)
    assert.match(packed.stderr, /astrale release file must be non-empty/u)
    assert.equal(existsSync(assetPath), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
