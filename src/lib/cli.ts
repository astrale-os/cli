import type { ApplicationId, ModuleId } from '@astrale-os/kernel-core'

export interface BuildOptions {
  entry: string
  outdir: string
  outfile: string
  minify: boolean
  sourcemap: boolean
  appId?: ApplicationId
  profile?: string
  noDeploy: boolean
}

export interface DevOptions {
  entry: string
  outdir: string
  outfile: string
  appId?: ApplicationId
  profile?: string
  noDeploy: boolean
  iframeEntry?: string
  iframeHtml?: string
  hostPort: number
  noServe: boolean
}

export interface InitOptions {
  title: string
  profile?: string
  parentId?: ModuleId
}

type ParsedArgs = Record<string, string | boolean>

function parseRawArgs(args: string[]): { positional: string[]; flags: ParsedArgs } {
  const positional: string[] = []
  const flags: ParsedArgs = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = args[i + 1]
      if (!next || next.startsWith('--')) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else if (!arg.startsWith('-')) {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

export function parseBuildArgs(args: string[]): BuildOptions {
  const { positional, flags } = parseRawArgs(args)
  const entry = positional[0]
  if (!entry) throw new Error('Entry path is required')
  return {
    entry,
    outdir: (flags['outdir'] as string) ?? 'dist',
    outfile: (flags['outfile'] as string) ?? 'worker.js',
    minify: !!flags['minify'],
    sourcemap: !!flags['sourcemap'],
    appId: flags['app-id'] as ApplicationId | undefined,
    profile: flags['profile'] as string | undefined,
    noDeploy: !!flags['no-deploy'],
  }
}

export function parseDevArgs(args: string[]): DevOptions {
  const { positional, flags } = parseRawArgs(args)
  const entry = positional[0]
  if (!entry) throw new Error('Entry path is required')
  return {
    entry,
    outdir: (flags['outdir'] as string) ?? 'dist',
    outfile: (flags['outfile'] as string) ?? 'worker.js',
    appId: flags['app-id'] as ApplicationId | undefined,
    profile: flags['profile'] as string | undefined,
    noDeploy: !!flags['no-deploy'],
    iframeEntry: flags['iframe-entry'] as string | undefined,
    iframeHtml: flags['iframe-html'] as string | undefined,
    hostPort: parseInt(flags['host-port'] as string, 10),
    noServe: !!flags['no-serve'],
  }
}

export function parseInitArgs(args: string[]): InitOptions {
  const { flags } = parseRawArgs(args)
  const title = flags['title'] as string | undefined
  const profile = flags['profile'] as string | undefined
  const parentId = flags['parent-id'] as string | undefined
  if (!title) throw new Error('--title is required')
  return { title, profile, parentId: parentId as ModuleId | undefined }
}

export function isHelpRequested(args: string[]): boolean {
  return args.length === 0 || args[0] === '--help' || args[0] === '-h'
}

export function showHelp(help: string): never {
  console.log(help)
  process.exit(0)
}

export const HELP = {
  build: `
Worker Build Script

Usage:
  astrale build <entry> [options]

Options:
  --outdir <dir>      Output directory (default: dist)
  --outfile <name>    Output filename (default: worker.js)
  --minify            Minify the output
  --sourcemap         Generate sourcemap
  --app-id <id>       Override appId from .astrale/config.json
  --profile <name>    Profile to use
  --no-deploy         Skip kernel deployment (bundle only)

Examples:
  astrale build src/worker.ts --minify
  astrale build src/worker.ts --no-deploy
`,
  dev: `
Worker Dev Script (Hot Reload)

Usage:
  astrale dev <entry> [options]

Options:
  --outdir <dir>        Output directory (default: dist)
  --outfile <name>      Output filename (default: worker.js)
  --app-id <id>         Override appId from .astrale/config.json
  --profile <name>      Profile to use
  --no-deploy           Skip kernel deployment (watch only)

  Dev Server Options:
  --iframe-entry <path> Iframe entry file (e.g., src/iframe.tsx)
  --iframe-html <path>  Iframe HTML template (e.g., src/iframe.html)
  --host-port <port>    Host app port
  --no-serve            Skip local dev servers (just build and deploy)

Examples:
  astrale dev src/worker.ts
  astrale dev src/worker.ts --iframe-entry src/iframe.tsx
`,
  init: `
Initialize a new Astrale app

Usage:
  astrale init --title <name> [options]

Required:
  --title <name>        Application title

Optional:
  --profile <name>      Profile to use (default: active profile)
  --parent-id <id>      Parent module ID (defaults to avatar)

Examples:
  astrale init --title "My App"
  astrale init --title "My App" --profile prod
`,
}
