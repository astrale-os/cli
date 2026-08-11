import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createPaths, type Paths } from './state/index'

export type TestEnv = {
  paths: Paths
  tmp: string
}

export async function createTestEnv(): Promise<TestEnv> {
  const tmp = await mkdtemp(join(tmpdir(), 'astrale-test-'))
  const paths = createPaths(tmp)
  await mkdir(paths.keys, { recursive: true })
  await mkdir(paths.data, { recursive: true })
  return { paths, tmp }
}
