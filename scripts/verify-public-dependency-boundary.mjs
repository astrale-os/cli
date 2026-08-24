import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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

const cliManifest = JSON.parse(await readFile('package.json', 'utf8'))
const cliKernelPackages = dependencyFields.flatMap((field) =>
  Object.keys(cliManifest[field] ?? {}).filter((name) => name.startsWith('@astrale-os/kernel-')),
)
assert.deepEqual(
  cliKernelPackages,
  [],
  'CLI manifest must consume Kernel semantics through the SDK facade',
)

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

const studioProject = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
})
const studioFiles = execFileSync('git', ['ls-files', 'studio'], { encoding: 'utf8' })
  .split('\n')
  .filter((path) => /\.(?:ts|tsx)$/u.test(path) && !path.startsWith('studio/client/dist/'))
for (const path of studioFiles) {
  studioProject.createSourceFile(path, await readFile(path, 'utf8'), { overwrite: true })
}
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
verifyImporter('.', cliManifest)
verifyImporter('studio', studioManifest)
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

function verifyImporter(name, manifest) {
  const importer = lock.importers?.[name]
  assert.ok(importer, `pnpm lock must contain importer ${name}`)
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const expected = manifest[field] ?? {}
    const actual = importer[field] ?? {}
    assert.deepEqual(
      Object.keys(actual).sort(),
      Object.keys(expected).sort(),
      `pnpm lock importer ${name} ${field} names must match its manifest`,
    )
    for (const [dependency, specifier] of Object.entries(expected)) {
      assert.equal(
        actual[dependency]?.specifier,
        specifier,
        `pnpm lock importer ${name} must retain ${field}.${dependency}`,
      )
    }
  }
}
