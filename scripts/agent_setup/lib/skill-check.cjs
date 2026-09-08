const fs = require('node:fs')
const path = require('node:path')

try {
  const directory = process.argv[2]
  const name = process.argv[3]
  const text = fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  const declared = /^name:\s*['"]?([^'"\r\n]+?)['"]?\s*$/m.exec(frontmatter ?? '')?.[1]
  if (declared !== name || !/^description:\s*\S/m.test(frontmatter)) process.exit(1)
  for (const match of text.matchAll(/\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
    const target = match[1].split('#')[0]
    if (
      /^(\.\/|references\/|scripts\/|assets\/|templates\/)/.test(target) &&
      !fs.existsSync(path.resolve(directory, target))
    )
      process.exit(1)
  }
} catch {
  process.exit(1)
}
