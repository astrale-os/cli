import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { Project, SyntaxKind } from 'ts-morph'
import { parse, parseAllDocuments } from 'yaml'

const privatePackages = [
  '@astrale-os/kernel-ports',
  '@astrale-os/kernel-runtime',
  '@astrale-os/kernel-backend',
  '@astrale-os/kernel-host',
]
const typescriptApiPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]typescript['"]/u
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]
const checkedFiles = [
  'package.json',
  'studio/package.json',
  'studio/e2e/fixture/package.json',
  '.npmrc',
  'studio/.npmrc',
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

for (const path of ['.npmrc', 'studio/.npmrc']) {
  const contents = await readFile(path, 'utf8')
  assert.doesNotMatch(contents, /_authToken|NODE_AUTH_TOKEN|NPM_TOKEN/u, `${path} stores auth`)
  assert.match(
    contents,
    /@astrale-os:registry=https:\/\/registry\.npmjs\.org\//u,
    `${path} must route public Astrale packages to npmjs`,
  )
}

for (const path of ['package.json', 'studio/package.json', 'studio/e2e/fixture/package.json']) {
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  for (const field of dependencyFields) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      assert.doesNotMatch(
        specifier,
        /^(?:file|link|workspace):/,
        `${path} ${field}.${name} must resolve through a registry package version`,
      )
      assert.doesNotMatch(
        specifier,
        /\.tgz(?:$|[?#])/u,
        `${path} ${field}.${name} must not resolve through a vendored package archive`,
      )
    }
  }
}

const workspaceConfig = parse(await readFile('pnpm-workspace.yaml', 'utf8'))
assert.equal(
  workspaceConfig.linkWorkspacePackages,
  false,
  'standalone CLI qualification must not link workspace packages',
)
assert.equal(
  workspaceConfig.preferWorkspacePackages,
  false,
  'standalone CLI qualification must not prefer workspace packages',
)
assert.equal(
  workspaceConfig.hoistWorkspacePackages,
  false,
  'standalone CLI qualification must not hoist workspace packages',
)
assert.equal(
  workspaceConfig.sharedWorkspaceLockfile,
  true,
  'CLI, Studio, and the browser fixture must share one exact qualification lock',
)
assert.equal(
  workspaceConfig.strictPeerDependencies,
  true,
  'CLI qualification must reject incompatible peer closures',
)
assert.equal(
  workspaceConfig.blockExoticSubdeps,
  true,
  'CLI qualification must reject exotic transitive dependency sources',
)
assert.equal(
  workspaceConfig.lockfileIncludeTarballUrl,
  true,
  'CLI qualification lock must expose exact registry tarball origins',
)
assert.equal(workspaceConfig.minimumReleaseAge, 10080, 'CLI must quarantine releases for 7 days')
assert.equal(
  workspaceConfig.minimumReleaseAgeStrict,
  true,
  'CLI release-age quarantine must fail closed',
)
assert.equal(
  workspaceConfig.minimumReleaseAgeIgnoreMissingTime,
  false,
  'CLI release-age quarantine must reject missing publication times',
)
assert.equal(workspaceConfig.trustLockfile, false, 'CLI must verify lock entries against policy')
assert.deepEqual(
  workspaceConfig.minimumReleaseAgeExclude,
  ['@astrale-os/*', '@astrale-domains/*', '@astrale/*', '@jsr/astrale__*', 'create-astrale-domain'],
  'CLI must use only the approved release-age exceptions',
)
assert.equal(
  workspaceConfig.overrides,
  undefined,
  'published CLI qualification must not use dependency version overrides',
)

const cliManifest = JSON.parse(await readFile('package.json', 'utf8'))
assert.equal(
  (await readFile('.bun-version', 'utf8')).trim(),
  '1.4.0',
  'CLI must pin the local Bun 1.4 runtime',
)
assert.equal(cliManifest.packageManager, 'pnpm@12.0.0', 'CLI must pin the qualification pnpm')
assert.equal(cliManifest.private, true, 'standalone-only CLI package must remain private')
assert.equal(cliManifest.publishConfig, undefined, 'standalone-only CLI must not be publishable')
assert.equal(
  cliManifest.devDependencies?.typescript,
  '7.0.2',
  'CLI source without TypeScript compiler API imports must pin TypeScript 7.0.2',
)
assert.equal(
  cliManifest.devDependencies?.['bun-types'],
  '1.4.0',
  'CLI root must pin the Bun 1.4 type package',
)
assert.equal(
  cliManifest.devDependencies?.['@types/bun'],
  undefined,
  'CLI root must not install the legacy Bun type alias',
)
assert.equal(
  cliManifest.devDependencies?.['@typescript/native-preview'],
  '7.0.0-dev.20260707.2',
  'CLI root must pin the approved native-preview compiler',
)
assert.match(cliManifest.scripts?.typecheck ?? '', /\btsgo\b/u, 'CLI root must typecheck with tsgo')
assert.doesNotMatch(cliManifest.scripts?.typecheck ?? '', /\btsc\b/u, 'CLI root must not use tsc')
assert.match(
  cliManifest.scripts?.typecheck ?? '',
  /pnpm --dir studio run typecheck/u,
  'CLI root must delegate Studio typechecking to the Studio package',
)
const buildScript = await readFile('scripts/build.ts', 'utf8')
assert.match(buildScript, /node_modules\/\.bin\/tsgo/u, 'CLI declarations must use tsgo')
assert.doesNotMatch(
  buildScript,
  /node_modules\/\.bin\/tsc/u,
  'CLI declaration build must not use tsc',
)
const cliTypeScriptFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((path) => path.length > 0 && existsSync(path))
  .filter(
    (path) =>
      /\.(?:[cm]?[jt]sx?|mjs|cjs)$/u.test(path) &&
      !path.startsWith('studio/') &&
      !path.startsWith('dist/'),
  )
const cliCompilerApiImports = []
for (const path of cliTypeScriptFiles) {
  if (typescriptApiPattern.test(await readFile(path, 'utf8'))) cliCompilerApiImports.push(path)
}
assert.deepEqual(
  cliCompilerApiImports,
  [],
  'CLI root TypeScript 7 profile must not import the TypeScript compiler API',
)
for (const lifecycle of ['preinstall', 'install', 'postinstall']) {
  assert.equal(
    cliManifest.scripts?.[lifecycle],
    undefined,
    `published CLI must not expose the repository-only ${lifecycle} lifecycle`,
  )
}
const cliKernelPackages = dependencyFields.flatMap((field) =>
  Object.keys(cliManifest[field] ?? {}).filter((name) => name.startsWith('@astrale-os/kernel-')),
)
assert.deepEqual(
  cliKernelPackages,
  [],
  'CLI manifest must consume Kernel semantics through the SDK facade',
)

const studioManifest = JSON.parse(await readFile('studio/package.json', 'utf8'))
assert.equal(
  studioManifest.devDependencies?.typescript,
  '~6.0.3',
  'Studio compiler API tests must use the approved TypeScript 6 range',
)
assert.equal(
  studioManifest.devDependencies?.['@typescript/native-preview'],
  '7.0.0-dev.20260707.2',
  'Studio must pin the approved native-preview compiler',
)
assert.match(
  studioManifest.scripts?.typecheck ?? '',
  /\btsgo\b/u,
  'Studio must typecheck with tsgo',
)
assert.doesNotMatch(
  studioManifest.scripts?.typecheck ?? '',
  /\btsc\b/u,
  'Studio must not typecheck with tsc',
)
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
  assert.equal(
    studioManifest.dependencies[facade],
    cliManifest.devDependencies?.[facade],
    `CLI and Studio must qualify the same exact ${facade} publication`,
  )
}

const studioProject = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
})
const studioFiles = execFileSync('git', ['ls-files', 'studio'], { encoding: 'utf8' })
  .split('\n')
  .filter((path) => /\.(?:ts|tsx)$/u.test(path) && !path.startsWith('studio/client/dist/'))
const studioCompilerApiImports = []
for (const path of studioFiles) {
  const contents = await readFile(path, 'utf8')
  if (typescriptApiPattern.test(contents)) studioCompilerApiImports.push(path)
  studioProject.createSourceFile(path, contents, { overwrite: true })
}
assert.ok(
  studioCompilerApiImports.length > 0,
  'Studio TypeScript 6 profile must remain justified by a compiler API import',
)
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

const fixtureManifest = JSON.parse(await readFile('studio/e2e/fixture/package.json', 'utf8'))
assert.equal(
  fixtureManifest.dependencies?.['@astrale-os/sdk'],
  cliManifest.devDependencies?.['@astrale-os/sdk'],
  'Studio browser fixture must qualify the current exact SDK publication',
)

const lockDocuments = parseAllDocuments(await readFile('pnpm-lock.yaml', 'utf8'))
assert.deepEqual(
  lockDocuments.flatMap((document) => document.errors),
  [],
  'pnpm lock must contain only valid YAML documents',
)
const qualificationLocks = lockDocuments
  .map((document) => document.toJS())
  .filter((document) => document?.settings && document?.importers?.studio)
assert.equal(
  qualificationLocks.length,
  1,
  'pnpm lock must contain one workspace qualification document',
)
const lock = qualificationLocks[0]
assert.equal(lock.settings?.autoInstallPeers, true, 'pnpm must auto-install SDK peer dependencies')
for (const [locator, snapshot] of Object.entries(lock.packages ?? {})) {
  if (!locator.startsWith('@astrale-os/') && !locator.startsWith('@astrale-domains/')) continue
  assert.match(
    snapshot.resolution?.tarball ?? '',
    /^https:\/\/registry\.npmjs\.org\//u,
    `${locator} must resolve from the public npm registry`,
  )
}
verifyImporter('.', cliManifest)
verifyImporter('studio', studioManifest)
verifyImporter('studio/e2e/fixture', fixtureManifest)
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
