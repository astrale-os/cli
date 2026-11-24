/**
 * The files of the `astrale view` host page: `index.html`, `main.js` and the chunks it imports on
 * demand, the node selector's stylesheet, and the fonts it names with their license. The server
 * serves exactly these; a build that emits anything else fails.
 */

/** Every file a viewer build may emit, by its path in the output directory. */
const VIEWER_FILE =
  /^(?:index\.html|main\.js|chunk-[a-z0-9]+\.js|finder\.css|fonts\/[a-z0-9-]+\.woff2|fonts\/[A-Za-z0-9-]+\.txt)$/u

/** The files the host page fetches besides itself, by their path under the session. */
const SERVED_FILE = /^\/(?:main\.js|chunk-[a-z0-9]+\.js|finder\.css|fonts\/[a-z0-9-]+\.woff2)$/u

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  woff2: 'font/woff2',
}

/** Whether a viewer build may emit `path`, relative to its output directory. */
export function isViewerFile(path: string): boolean {
  return VIEWER_FILE.test(path)
}

/** The content type of a host page file the server may serve at `path`, or nothing. */
export function viewerFileContentType(path: string): string | undefined {
  if (!SERVED_FILE.test(path)) return undefined
  return CONTENT_TYPES[path.slice(path.lastIndexOf('.') + 1)]
}
