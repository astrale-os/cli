import type { PackageManager } from './model'

import { run, type RunResult } from '../lib/proc'

export type UiRunner = (file: string, args: string[], cwd: string) => Promise<RunResult>

export const defaultUiRunner: UiRunner = (file, args, cwd) => run(file, args, { cwd })

export function shadcnInvocation(
  manager: PackageManager,
  version: string,
  args: string[],
): { file: string; args: string[] } {
  if (manager === 'pnpm') return { file: 'pnpm', args: ['dlx', 'shadcn@' + version, ...args] }
  if (manager === 'bun') return { file: 'bunx', args: ['shadcn@' + version, ...args] }
  if (manager === 'yarn') return { file: 'yarn', args: ['dlx', 'shadcn@' + version, ...args] }
  return { file: 'npx', args: ['--yes', 'shadcn@' + version, ...args] }
}
