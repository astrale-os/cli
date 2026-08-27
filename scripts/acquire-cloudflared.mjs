#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const lockPath = new URL('../cloudflared.lock.json', import.meta.url)
const supportedPlatforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']

function acceptLock(input) {
  if (
    input?.repository !== 'cloudflare/cloudflared' ||
    typeof input.version !== 'string' ||
    input.version.length === 0 ||
    input.license !== 'Apache-2.0' ||
    input.assets === null ||
    typeof input.assets !== 'object' ||
    Array.isArray(input.assets) ||
    JSON.stringify(Object.keys(input.assets).sort()) !==
      JSON.stringify([...supportedPlatforms].sort())
  ) {
    throw new TypeError('cloudflared lock does not contain the exact supported release closure')
  }

  for (const platform of supportedPlatforms) {
    const asset = input.assets[platform]
    if (
      typeof asset?.name !== 'string' ||
      asset.name.includes('/') ||
      !/^[a-f0-9]{64}$/u.test(asset.sha256)
    ) {
      throw new TypeError(`cloudflared lock asset is invalid for ${platform}`)
    }
  }
  return Object.freeze(input)
}

export const CLOUDFLARED_RELEASE = acceptLock(JSON.parse(await readFile(lockPath, 'utf8')))

export function resolveCloudflaredAsset(platform) {
  if (!supportedPlatforms.includes(platform)) {
    throw new TypeError(`unsupported cloudflared release platform: ${platform}`)
  }
  const asset = CLOUDFLARED_RELEASE.assets[platform]
  return Object.freeze({
    ...asset,
    platform,
    version: CLOUDFLARED_RELEASE.version,
    url:
      `https://github.com/${CLOUDFLARED_RELEASE.repository}/releases/download/` +
      `${CLOUDFLARED_RELEASE.version}/${asset.name}`,
  })
}

function tarName(header) {
  return header.subarray(0, 100).toString('utf8').replace(/\0.*$/u, '')
}

function tarOctal(header, offset, length) {
  const value = header
    .subarray(offset, offset + length)
    .toString('ascii')
    .replace(/\0.*$/u, '')
    .trim()
  if (!/^[0-7]+$/u.test(value)) throw new Error('cloudflared archive has an invalid tar header')
  return Number.parseInt(value, 8)
}

export function extractDarwinCloudflared(compressed) {
  const tar = gunzipSync(compressed)
  const files = []
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = tarName(header)
    const type = header[156]
    const size = tarOctal(header, 124, 12)
    const contentStart = offset + 512
    const contentEnd = contentStart + size
    if ((type !== 0 && type !== 0x30) || contentEnd > tar.length) {
      throw new Error('cloudflared archive must contain only ordinary files')
    }
    files.push({ name, bytes: tar.subarray(contentStart, contentEnd) })
    offset = contentStart + Math.ceil(size / 512) * 512
  }

  if (files.length !== 1 || files[0].name !== 'cloudflared' || files[0].bytes.length === 0) {
    throw new Error(
      'cloudflared Darwin archive must contain exactly one non-empty cloudflared file',
    )
  }
  return Buffer.from(files[0].bytes)
}

async function defaultDownload(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

export async function acquireCloudflared(platform, outputPath, dependencies = {}) {
  const asset = dependencies.asset ?? resolveCloudflaredAsset(platform)
  const download = dependencies.download ?? defaultDownload
  const downloaded = Buffer.from(await download(asset.url))
  const digest = createHash('sha256').update(downloaded).digest('hex')
  if (digest !== asset.sha256) {
    throw new Error(
      `cloudflared checksum mismatch for ${asset.name}: expected ${asset.sha256}, got ${digest}`,
    )
  }

  const executable = platform.startsWith('darwin-')
    ? extractDarwinCloudflared(downloaded)
    : downloaded
  if (executable.length === 0) throw new Error('cloudflared release binary is empty')

  const staged = `${outputPath}.next`
  await rm(staged, { force: true })
  try {
    await writeFile(staged, executable, { mode: 0o755 })
    await chmod(staged, 0o755)
    await rename(staged, outputPath)
  } catch (error) {
    await rm(staged, { force: true }).catch(() => undefined)
    throw error
  }
  return asset
}

async function main() {
  const [platform, outputPath, ...extra] = process.argv.slice(2)
  if (!platform || !outputPath || extra.length > 0) {
    throw new TypeError(
      'Usage: node scripts/acquire-cloudflared.mjs <darwin|linux>-<arm64|x64> <output>',
    )
  }
  const asset = await acquireCloudflared(platform, outputPath)
  process.stdout.write(
    `${JSON.stringify({ platform, version: asset.version, source: asset.name, output: outputPath })}\n`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
