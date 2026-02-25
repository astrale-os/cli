import { Command } from 'commander'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { log } from '../lib/logger'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = resolve(__dirname, '..', '..', 'templates')

async function copyDir(
  src: string,
  dest: string,
  replacements: Record<string, string>,
): Promise<void> {
  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, replacements)
    } else {
      let content = await readFile(srcPath, 'utf-8')
      for (const [key, value] of Object.entries(replacements)) {
        content = content.replaceAll(`{{${key}}}`, value)
      }
      await writeFile(destPath, content)
    }
  }
}

async function runCreate(name: string, template: string): Promise<void> {
  const targetDir = resolve(process.cwd(), name)
  const templateDir = join(TEMPLATES_DIR, template)

  // Verify template exists
  if (!existsSync(templateDir)) {
    log.error(`Template "${template}" not found`)
    const templates = await readdir(TEMPLATES_DIR)
    console.log('\nAvailable templates:')
    for (const t of templates) {
      console.log(`  - ${t}`)
    }
    process.exit(1)
  }

  // Verify target doesn't exist
  if (existsSync(targetDir)) {
    log.error(`Directory "${name}" already exists`)
    process.exit(1)
  }

  const appSlug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const appName = name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  await copyDir(templateDir, targetDir, {
    APP_NAME: appName,
    APP_SLUG: appSlug,
    PACKAGE_NAME: `@astrale/${appSlug}`,
    GRAPH_NAME: appSlug.replace(/-/g, '_'),
  })

  log.blank()
  log.success(`Created ${name}`)
  log.blank()
  console.log('  Next steps:')
  console.log(`    cd ${name}`)
  console.log('    pnpm install')
  console.log('    astrale generate --scaffold')
  console.log('    astrale dev')
  log.blank()
}

export const createCommand = new Command('create')
  .description('Scaffold a new Astrale distribution project')
  .argument('<name>', 'Project name (used as directory name)')
  .option('-t, --template <name>', 'Template to use', 'blank')
  .action(async (name, opts) => {
    try {
      await runCreate(name, opts.template)
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })
