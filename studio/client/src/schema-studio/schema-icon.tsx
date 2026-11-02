import type * as React from 'react'

import { useMemo } from 'react'

import { cn } from '@/lib/utils'

import { sanitizeSvg } from './sanitize-svg'

/**
 * Renders a domain class's `icon` — raw (lucide-style) SVG markup carried in the
 * schema IR. The SVG uses `stroke="currentColor"`, so it tints with the
 * surrounding text color. Any Domain can author it, so it is rebuilt from an
 * allowlist of drawing elements and attributes before being injected.
 */

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
      // rebuilt by sanitizeSvg from allowlisted elements and attributes only
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
