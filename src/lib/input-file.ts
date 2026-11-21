import { readFile } from 'node:fs/promises'

import { AstraleError } from '../errors'

/**
 * Read a text file the caller named. A missing or unreadable file is the caller's to fix, so it is
 * refused with FILE_READ_FAILED, naming `label` (the flag and path, or the path alone).
 */
export async function readInputFile(path: string, label = path): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    throw new AstraleError('FILE_READ_FAILED', `Cannot read ${label}.`, undefined, {
      cause: error,
    })
  }
}
