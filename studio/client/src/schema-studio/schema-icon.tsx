import type * as React from 'react'

import { useMemo } from 'react'

import { cn } from '@/lib/utils'

/**
 * Renders a domain class's `icon` — raw (lucide-style) SVG markup carried in the
 * schema IR. The SVG uses `stroke="currentColor"`, so it tints with the
 * surrounding text color. Markup is sanitized (no scripts / event handlers /
 * external refs) before being injected, since it is authored in domain code.
 */

function sanitizeSvg(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('<svg')) return null
  let s = trimmed
  // strip anything executable or external
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
  s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
  s = s.replace(/\son\w+\s*=\s*'[^']*'/gi, '')
  s = s.replace(/(href|xlink:href)\s*=\s*"(?!#)[^"]*"/gi, '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  // force it to fill its box and inherit color
  s = s.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    let a = attrs.replace(/\swidth\s*=\s*"[^"]*"/i, '').replace(/\sheight\s*=\s*"[^"]*"/i, '')
    if (!/viewBox=/i.test(a)) a += ' viewBox="0 0 24 24"'
    return `<svg${a} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`
  })
  return s
}

export function SchemaIcon({
  svg,
  className,
  style,
}: {
  svg?: string
  className?: string
  style?: React.CSSProperties
}) {
  const clean = useMemo(() => (svg ? sanitizeSvg(svg) : null), [svg])
  if (!clean) return null
  return (
    <span
      style={style}
      className={cn(
        'inline-flex shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full',
        className,
      )}
      // sanitized above; SVG is authored in the domain's own schema code
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}

export function hasIcon(svg?: string): boolean {
  return !!svg && svg.trim().startsWith('<svg')
}
