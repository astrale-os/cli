/**
 * astrale create
 *
 * Scaffolds a new Astrale app from a template.
 */

import { Command } from 'commander'
import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

export type CreateOptions = {
  name: string
  template: string
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates')

async function copyDir(
  src: string,
  dest: string,
  replacements: Record<string, string>,
): Promise<void> {
  await mkdir(dest, { recursive: true })

  const entries = await readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, replacements)
    } else {
      let content = await readFile(srcPath, 'utf-8')

      // Apply replacements
      for (const [key, value] of Object.entries(replacements)) {
        content = content.replaceAll(`{{${key}}}`, value)
      }

      await writeFile(destPath, content)
    }
  }
}

export async function runCreate(options: CreateOptions): Promise<void> {
  const targetDir = path.resolve(process.cwd(), options.name)
  const templateDir = path.join(TEMPLATES_DIR, options.template)

  console.log(`\n[astrale] Creating new app: ${options.name}`)
  console.log(`  Template: ${options.template}`)
  console.log(`  Location: ${targetDir}\n`)

  // Check if template exists
  try {
    await readdir(templateDir)
  } catch {
    console.error(`✗ Template "${options.template}" not found`)
    console.log(`\nAvailable templates:`)
    const templates = await readdir(TEMPLATES_DIR)
    for (const t of templates) {
      console.log(`  - ${t}`)
    }
    process.exit(1)
  }

  // Check if target exists
  try {
    await readdir(targetDir)
    console.error(`✗ Directory "${options.name}" already exists`)
    process.exit(1)
  } catch {
    // Good - directory doesn't exist
  }

  // Copy template with replacements
  const appSlug = options.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const appName = options.name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  await copyDir(templateDir, targetDir, {
    APP_NAME: appName,
    APP_SLUG: appSlug,
    PACKAGE_NAME: `@astrale/app-${appSlug}`,
  })

  console.log(`✓ Created ${options.name}`)
  console.log(`\nNext steps:`)
  console.log(`  cd ${options.name}`)
  console.log(`  pnpm install`)
  console.log(
    `  astrale init --title "${appName}" --kernel-url ws://localhost:8081 --avatar-id $AVATAR_ID --token $TOKEN`,
  )
  console.log(`  astrale dev src/worker.ts --iframe-entry src/window/index.tsx`)
}

export const createCommand = new Command('create')
  .description('Create a new Astrale app from a template')
  .argument('<name>', 'App name (will be used as directory name)')
  .option('-t, --template <name>', 'Template to use', 'react-app')
  .action(async (name, opts) => {
    try {
      await runCreate({
        name,
        template: opts.template,
      })
    } catch (err) {
      console.error('[astrale] Create failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
