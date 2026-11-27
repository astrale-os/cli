/** Build the client the browser run serves, into the run's own folder. */
import { join } from 'node:path'

import { e2eDist, studioRoot } from './dist'

const vite = join(studioRoot, 'node_modules', '.bin', 'vite')
const built = Bun.spawnSync([vite, 'build', '--outDir', e2eDist, '--emptyOutDir'], {
  cwd: studioRoot,
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit',
})

process.exit(built.exitCode)
