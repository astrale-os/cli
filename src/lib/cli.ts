/**
 * CLI Argument Parsing
 *
 * Shared utilities for build, dev, and init scripts.
 */

import type { ApplicationId, AvatarId, ModuleId } from "@astrale-os/kernel-core"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildOptions {
  entry: string
  outdir: string
  outfile: string
  minify: boolean
  sourcemap: boolean
  appId?: ApplicationId
  kernelUrl?: string
  noDeploy: boolean
}

export interface DevOptions {
  entry: string
  outdir: string
  outfile: string
  appId?: ApplicationId
  kernelUrl?: string
  noDeploy: boolean
  /** Iframe entry file (e.g., src/iframe.tsx) */
  iframeEntry?: string
  /** Iframe HTML template */
  iframeHtml?: string
  hostPort: number
  /** Skip local dev servers (just build and deploy) */
  noServe: boolean
}

export interface InitOptions {
  title: string
  kernelUrl: string
  kernelRpcUrl: string
  avatarId: AvatarId
  token: string
  parentId?: ModuleId
}

// ─────────────────────────────────────────────────────────────────────────────
// Argument Parsing
// ─────────────────────────────────────────────────────────────────────────────

type ParsedArgs = Record<string, string | boolean>

function parseRawArgs(args: string[]): {
  positional: string[]
  flags: ParsedArgs
} {
  const positional: string[] = []
  const flags: ParsedArgs = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue

    if (arg.startsWith("--")) {
      const key = arg.slice(2)
      const next = args[i + 1]

      // Boolean flags or flags without values
      if (!next || next.startsWith("--")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else if (!arg.startsWith("-")) {
      positional.push(arg)
    }
  }

  return { positional, flags }
}

export function parseBuildArgs(args: string[]): BuildOptions {
  const { positional, flags } = parseRawArgs(args)
  const entry = positional[0]

  if (!entry) {
    throw new Error("Entry path is required")
  }

  return {
    entry,
    outdir: (flags["outdir"] as string) ?? "dist",
    outfile: (flags["outfile"] as string) ?? "worker.js",
    minify: !!flags["minify"],
    sourcemap: !!flags["sourcemap"],
    appId: flags["app-id"] as ApplicationId | undefined,
    kernelUrl: flags["kernel-url"] as string | undefined,
    noDeploy: !!flags["no-deploy"],
  }
}

export function parseDevArgs(args: string[]): DevOptions {
  const { positional, flags } = parseRawArgs(args)
  const entry = positional[0]

  if (!entry) {
    throw new Error("Entry path is required")
  }

  return {
    entry,
    outdir: (flags["outdir"] as string) ?? "dist",
    outfile: (flags["outfile"] as string) ?? "worker.js",
    appId: flags["app-id"] as ApplicationId | undefined,
    kernelUrl: flags["kernel-url"] as string | undefined,
    noDeploy: !!flags["no-deploy"],
    iframeEntry: flags["iframe-entry"] as string | undefined,
    iframeHtml: flags["iframe-html"] as string | undefined,
    hostPort: parseInt(flags["host-port"] as string, 10),
    noServe: !!flags["no-serve"],
  }
}

export function parseInitArgs(args: string[]): InitOptions {
  const { flags } = parseRawArgs(args)

  const title = flags["title"] as string | undefined
  const kernelUrl = flags["kernel-url"] as string | undefined
  const kernelRpcUrl = flags["kernel-rpc-url"] as string | undefined
  const avatarId = flags["avatar-id"] as string | undefined
  const token = flags["token"] as string | undefined
  const parentId = flags["parent-id"] as string | undefined

  if (!title) throw new Error("--title is required")
  if (!kernelUrl) throw new Error("--kernel-url is required")
  if (!kernelRpcUrl) throw new Error("--kernel-rpc-url is required")
  if (!avatarId) throw new Error("--avatar-id is required")
  if (!token) throw new Error("--token is required")

  return {
    title,
    kernelUrl,
    kernelRpcUrl,
    avatarId: avatarId as AvatarId,
    token,
    parentId: parentId as ModuleId | undefined,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Help
// ─────────────────────────────────────────────────────────────────────────────

export function isHelpRequested(args: string[]): boolean {
  return args.length === 0 || args[0] === "--help" || args[0] === "-h"
}

export function showHelp(help: string): never {
  console.log(help)
  process.exit(0)
}

export const HELP = {
  build: `
Worker Build Script

Usage:
  worker-build <entry> [options]

Options:
  --outdir <dir>      Output directory (default: dist)
  --outfile <name>    Output filename (default: worker.js)
  --minify            Minify the output
  --sourcemap         Generate sourcemap
  --app-id <id>       Override appId from .astrale/config.json
  --kernel-url <url>  Override kernel URL from .astrale/config.json
  --no-deploy         Skip kernel deployment (bundle only)

Examples:
  worker-build src/worker.ts --minify
  worker-build src/worker.ts --no-deploy
`,

  dev: `
Worker Dev Script (Hot Reload)

Usage:
  worker-dev <entry> [options]

Options:
  --outdir <dir>        Output directory (default: dist)
  --outfile <name>      Output filename (default: worker.js)
  --app-id <id>         Override appId from .astrale/config.json
  --kernel-url <url>    Override kernel URL from .astrale/config.json
  --no-deploy           Skip kernel deployment (watch only)

  Dev Server Options:
  --iframe-entry <path> Iframe entry file (e.g., src/iframe.tsx)
  --iframe-html <path>  Iframe HTML template (e.g., src/iframe.html)
  --host-port <port>    Host app port
  --no-serve            Skip local dev servers (just build and deploy)

  Worker/UI ports are read from .astrale/config.json (workerUrl, uiUrl).

Examples:
  worker-dev src/worker.ts
  worker-dev src/worker.ts --iframe-entry src/iframe.tsx
`,

  init: `
Worker Init Script

Creates a new application in the kernel and sets up .astrale/config.json

Usage:
  worker-init --title <name> --kernel-url <url> --kernel-rpc-url <url> --avatar-id <id> --token <token> [options]

Required:
  --title <name>            Application title
  --kernel-url <url>        Kernel WebSocket URL (e.g., ws://localhost:8081)
  --kernel-rpc-url <url>    Kernel RPC URL (e.g., http://localhost:8083)
  --avatar-id <id>          Avatar ID for authenticated calls
  --token <token>           Authentication token

Optional:
  --parent-id <id>          Parent module ID (defaults to avatar's development folder)

Examples:
  worker-init --title "Chat App" --kernel-url ws://localhost:8081 --kernel-rpc-url http://localhost:8083 --avatar-id avatar_123 --token tok_abc
`,
}
