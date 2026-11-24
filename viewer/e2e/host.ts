import type { Route } from '@playwright/test'

import { readFileSync } from 'node:fs'

import { viewerFileContentType } from '../../src/lib/view/viewer-files'

const dist = new URL('../dist/', import.meta.url)

/** Answer a host page request as the `astrale view` server does: a built file, else the page. */
export function fulfillHostPage(route: Route, pathname: string): Promise<void> {
  const contentType = viewerFileContentType(pathname)
  return contentType === undefined
    ? route.fulfill({ contentType: 'text/html', body: readFileSync(new URL('index.html', dist)) })
    : route.fulfill({ contentType, body: readFileSync(new URL(pathname.slice(1), dist)) })
}
