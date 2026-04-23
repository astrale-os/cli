/// <reference types="node" />
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const playgroundDistDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
