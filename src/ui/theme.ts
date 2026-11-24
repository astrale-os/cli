/** Colors and effects: a theme declares each one in its light rule and again in its dark rule. */
export const THEME_MODE_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'shadow-control',
  'shadow-panel',
] as const

/**
 * Shape, density, type, and motion: a theme declares each one in its light rule, which every
 * element its dark rule matches also matches.
 */
export const THEME_SHARED_TOKENS = [
  'font-body',
  'font-heading',
  'radius',
  'radius-panel',
  'control-height',
  'control-height-sm',
  'control-height-lg',
  'motion-fast',
  'motion-standard',
] as const

const THEME_MAX_BYTES = 131_072
const COMMENT = /\/\*[\s\S]*?\*\//gu
const RULE = /([^{}]*)\{([^{}]*)\}/gu
const DECLARATION = /(?:^|;)\s*--ui-([a-z0-9-]+)\s*:/gu

/**
 * Why `source` is not an admitted stylesheet of the theme `slug`, or undefined when it is.
 *
 * An admitted theme is a bounded, consumer-owned stylesheet of plain style rules that loads no
 * other resource. Its `[data-ui-theme='<slug>']` rule declares every mode and shared token, and its
 * `[data-ui-theme='<slug>'].dark` rule declares every mode token again.
 */
export function themeCssRefusal(source: string, slug: string): string | undefined {
  if (new TextEncoder().encode(source).byteLength > THEME_MAX_BYTES) return 'it exceeds 128 KiB'
  if (!source.includes('Consumer-owned after installation.')) {
    return 'it is not marked consumer-owned'
  }
  if (/@import\b|url\s*\(/iu.test(source)) return 'it loads another resource'
  const css = source.replace(COMMENT, '')
  if (css.replace(RULE, '').trim() !== '') return 'it holds more than plain style rules'
  const rules = [...css.matchAll(RULE)].map(([, selectors = '', body = '']) => ({
    selectors: selectors.split(',').map((selector) => selector.trim()),
    tokens: new Set([...body.matchAll(DECLARATION)].map(([, token]) => token)),
  }))
  for (const [selector, required] of [
    [`[data-ui-theme='${slug}']`, [...THEME_MODE_TOKENS, ...THEME_SHARED_TOKENS]],
    [`[data-ui-theme='${slug}'].dark`, THEME_MODE_TOKENS],
  ] as const) {
    const rule = rules.find((candidate) => candidate.selectors.includes(selector))
    if (!rule) return 'it has no ' + selector + ' rule'
    const missing = required.find((token) => !rule.tokens.has(token))
    if (missing !== undefined) return 'its ' + selector + ' rule omits --ui-' + missing
  }
  return undefined
}
