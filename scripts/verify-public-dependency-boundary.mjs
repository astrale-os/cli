import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Project, SyntaxKind } from 'ts-morph'
import { parse } from 'yaml'

const privatePackages = ['@astrale-os/kernel-ports', '@astrale-os/kernel-runtime']
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]
const checkedFiles = [
  'package.json',
  'studio/package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
]

for (const path of checkedFiles) {
  const contents = await readFile(path, 'utf8')
  for (const privatePackage of privatePackages) {
    assert.equal(
      contents.includes(privatePackage),
      false,
      `${path} exposes the private package ${privatePackage}`,
    )
  }
}

for (const path of ['package.json', 'studio/package.json']) {
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  for (const field of dependencyFields) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (!name.startsWith('@astrale-os/')) continue
      assert.doesNotMatch(
        specifier,
        /^(?:file|link|workspace):/,
        `${path} ${field}.${name} must resolve through an ordinary package version`,
      )
    }
  }
}

const studioManifest = JSON.parse(await readFile('studio/package.json', 'utf8'))
const studioPackages = dependencyFields.flatMap((field) =>
  Object.entries(studioManifest[field] ?? {}),
)
assert.deepEqual(
  studioPackages.filter(
    ([name, specifier]) =>
      name.startsWith('@astrale-os/kernel-') ||
      (typeof specifier === 'string' && specifier.startsWith('npm:@astrale-os/kernel-')),
  ),
  [],
  'Studio manifests must consume Kernel semantics through SDK and Shell facades',
)
for (const facade of ['@astrale-os/sdk', '@astrale-os/shell']) {
  assert.equal(
    Object.hasOwn(studioManifest.dependencies ?? {}, facade),
    true,
    `studio/package.json dependencies must declare ${facade}`,
  )
}

const studioProject = new Project({ skipAddingFilesFromTsConfig: true })
studioProject.addSourceFilesAtPaths([
  'studio/**/*.ts',
  'studio/**/*.tsx',
  '!studio/client/dist/**',
  '!studio/node_modules/**',
])
const studioKernelReferences = studioProject.getSourceFiles().flatMap((sourceFile) =>
  [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
  ]
    .map((literal) => literal.getLiteralValue())
    .filter((specifier) => specifier.startsWith('@astrale-os/kernel-'))
    .map((specifier) => `${sourceFile.getFilePath()}: ${specifier}`),
)
assert.deepEqual(studioKernelReferences, [], 'Studio source references Kernel packages directly')

const lock = parse(await readFile('pnpm-lock.yaml', 'utf8'))
assert.equal(lock.settings?.autoInstallPeers, true, 'pnpm must auto-install SDK peer dependencies')
const studioImporter = lock.importers?.studio?.dependencies
const sdkResolution = studioImporter?.['@astrale-os/sdk']?.version
const shellResolution = studioImporter?.['@astrale-os/shell']?.version
assert.equal(typeof sdkResolution, 'string', 'Studio lock must resolve SDK')
assert.equal(typeof shellResolution, 'string', 'Studio lock must resolve Shell')
const sdkPackage = lock.packages?.[`@astrale-os/sdk@${packageVersion(sdkResolution)}`]
const shellPackage = lock.packages?.[`@astrale-os/shell@${packageVersion(shellResolution)}`]
assert.ok(sdkPackage, "pnpm lock must describe Studio's exact SDK package")
assert.ok(shellPackage, "pnpm lock must describe Studio's exact Shell package")
const requiredKernelPeers = new Set([...requiredPeers(sdkPackage), ...requiredPeers(shellPackage)])
for (const peer of requiredKernelPeers) {
  const sdkVersion = peerVersion(sdkResolution, peer)
  assert.notEqual(sdkVersion, null, `Studio SDK resolution omits required peer ${peer}`)
  assert.equal(
    peerVersion(shellResolution, peer),
    sdkVersion,
    `Studio SDK and Shell resolve different ${peer} versions`,
  )
}

for (const path of ['pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
  const contents = await readFile(path, 'utf8')
  assert.equal(contents.includes('.cohort'), false, `${path} contains exact-source topology`)
  assert.equal(
    /vendor\/astrale-os-(?:sdk|shell)-[^\s]+\.tgz/.test(contents),
    false,
    `${path} resolves a vendored Astrale package archive`,
  )
}

console.log('verified CLI public dependency closure excludes private Kernel packages')

function peerVersion(resolution, peer) {
  const start = resolution.indexOf(`${peer}@`)
  if (start === -1) return null
  const version = resolution.slice(start + peer.length + 1)
  const end = version.search(/[()]/u)
  return end === -1 ? version : version.slice(0, end)
}

function packageVersion(resolution) {
  const end = resolution.indexOf('(')
  return end === -1 ? resolution : resolution.slice(0, end)
}

function requiredPeers(packageSnapshot) {
  return Object.keys(packageSnapshot.peerDependencies ?? {}).filter(
    (name) =>
      name.startsWith('@astrale-os/kernel-') &&
      packageSnapshot.peerDependenciesMeta?.[name]?.optional !== true,
  )
}
