import { expect, test } from 'bun:test'
import { realpathSync } from 'node:fs'

import { encodeStudioCliDescriptor } from '../studio'

test('Studio descriptor preserves the exact runtime and script entrypoint', () => {
  expect(JSON.parse(encodeStudioCliDescriptor(process.execPath, import.meta.path))).toEqual({
    version: 1,
    executable: process.execPath,
    args: [realpathSync(import.meta.path)],
  })
})

test('Studio descriptor reinvokes a compiled executable without its virtual bunfs entry', () => {
  expect(JSON.parse(encodeStudioCliDescriptor('/opt/bin/astrale', '/$bunfs/root/astrale'))).toEqual(
    {
      version: 1,
      executable: '/opt/bin/astrale',
      args: [],
    },
  )
})
