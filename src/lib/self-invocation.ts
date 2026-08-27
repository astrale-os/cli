import { existsSync } from 'node:fs'

/** Reinvoke this CLI from source or from a Bun-compiled standalone executable. */
export function selfInvocation(
  args: string[],
  executable = process.execPath,
  entry = process.argv[1],
): { file: string; args: string[] } {
  const prefix =
    entry && entry !== executable && !entry.startsWith('/$bunfs/') && existsSync(entry)
      ? [entry]
      : []
  return { file: executable, args: [...prefix, ...args] }
}
