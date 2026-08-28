import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'

import {
  acquireCloudflared,
  CLOUDFLARED_RELEASE,
  extractDarwinCloudflared,
  resolveCloudflaredAsset,
} from './acquire-cloudflared.mjs'

function tarEntry(name, bytes, type = 0x30) {
  const header = Buffer.alloc(512)
  Buffer.from(name).copy(header, 0)
  Buffer.from('0000755\0').copy(header, 100)
  Buffer.from(bytes.length.toString(8).padStart(11, '0') + '\0').copy(header, 124)
  header[156] = type
  return Buffer.concat([header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)])
}

function darwinArchive(entries) {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]))
}

test('the immutable lock maps the exact four Astrale platforms', () => {
  assert.equal(CLOUDFLARED_RELEASE.version, '2026.8.2')
  assert.deepEqual(Object.keys(CLOUDFLARED_RELEASE.assets).sort(), [
    'darwin-arm64',
    'darwin-x64',
    'linux-arm64',
    'linux-x64',
  ])
  assert.match(resolveCloudflaredAsset('darwin-x64').name, /darwin-amd64\.tgz$/u)
  assert.match(resolveCloudflaredAsset('linux-x64').name, /linux-amd64$/u)
  assert.throws(() => resolveCloudflaredAsset('win32-x64'), /unsupported/u)
})

test('Darwin extraction admits only one ordinary cloudflared file', () => {
  const bytes = Buffer.from('provider bytes')
  assert.deepEqual(extractDarwinCloudflared(darwinArchive([tarEntry('cloudflared', bytes)])), bytes)
  assert.throws(
    () =>
      extractDarwinCloudflared(
        darwinArchive([tarEntry('cloudflared', bytes), tarEntry('unexpected', bytes)]),
      ),
    /exactly one/u,
  )
  assert.throws(
    () => extractDarwinCloudflared(darwinArchive([tarEntry('../cloudflared', bytes)])),
    /exactly one/u,
  )
  assert.throws(
    () => extractDarwinCloudflared(darwinArchive([tarEntry('cloudflared', bytes, 0x32)])),
    /ordinary files/u,
  )
})

test('acquisition verifies pinned bytes before committing the normalized executable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'astrale-cloudflared-acquire-'))
  try {
    const output = join(root, 'astrale-cloudflared')
    const platform = 'linux-arm64'
    const asset = resolveCloudflaredAsset(platform)
    const accepted = Buffer.from('accepted provider')
    const acceptedAsset = {
      ...asset,
      sha256: createHash('sha256').update(accepted).digest('hex'),
    }
    await acquireCloudflared(platform, output, {
      asset: acceptedAsset,
      download: async (url) => {
        assert.equal(url, asset.url)
        return accepted
      },
    })
    assert.deepEqual(readFileSync(output), accepted)

    await assert.rejects(
      acquireCloudflared(platform, output, {
        asset: acceptedAsset,
        download: async () => Buffer.from('corrupt'),
      }),
      /checksum mismatch/u,
    )
    assert.deepEqual(readFileSync(output), accepted)
    assert.equal(existsSync(`${output}.next`), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
