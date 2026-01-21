import type { Plugin } from 'esbuild'
import { existsSync, readFileSync } from 'fs'
import { createRequire } from 'module'
import path from 'path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'

export const LIVE_RELOAD_SCRIPT = `<script>
(function() {
  const es = new EventSource('/__dev/events');
  es.onmessage = e => e.data === 'reload' && location.reload();
})();
</script>`

export function createDedupeReactPlugin(projectRoot: string): Plugin {
  const projectRequire = createRequire(path.join(projectRoot, 'package.json'))

  const resolve = (pkg: string): string => {
    try {
      return projectRequire.resolve(pkg)
    } catch {
      return ''
    }
  }

  return {
    name: 'dedupe-react',
    setup(build) {
      const packages = [
        'react',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom',
        'react-dom/client',
      ]
      for (const pkg of packages) {
        const filter = new RegExp(`^${pkg.replace('/', '\\/')}$`)
        build.onResolve({ filter }, () => {
          const resolved = resolve(pkg)
          return resolved ? { path: resolved } : null
        })
      }
    },
  }
}

/**
 * Creates an esbuild plugin that processes CSS through PostCSS with Tailwind CSS.
 * CSS output is stored in the provided object for later retrieval.
 */
export function createPostCSSPlugin(projectRoot: string, cssOutput: { code: string }): Plugin {
  const processor = postcss([tailwindcss()])

  return {
    name: 'postcss-tailwind',
    setup(build) {
      // Handle CSS imports in JS/TS files
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const source = readFileSync(args.path, 'utf-8')

        try {
          const result = await processor.process(source, {
            from: args.path,
            to: args.path,
          })

          // Store the processed CSS for serving separately at /iframe-bundle.css
          cssOutput.code = result.css

          // Return empty JS - the CSS is served separately and linked in HTML
          return {
            contents: '/* CSS processed by PostCSS/Tailwind - served at /iframe-bundle.css */',
            loader: 'js',
          }
        } catch (error) {
          return {
            errors: [
              {
                text: `PostCSS error: ${error instanceof Error ? error.message : String(error)}`,
                location: { file: args.path },
              },
            ],
          }
        }
      })
    },
  }
}

export function getRepoRoot(currentDir: string): string {
  let dir = currentDir
  // Look up for pnpm-lock.yaml or similar root marker
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) {
      return dir
    }
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Fallback to fixed path if detection fails (original behavior was likely aiming for monorepo root)
  // currentDir is .../src/lib/server
  // ../../../.. -> .../
  return path.resolve(currentDir, '../../../..')
}
