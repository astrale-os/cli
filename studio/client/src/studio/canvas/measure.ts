/**
 * Text measured the way the canvas renders it: the page's own fonts, through a canvas
 * context, cached per font and string. Layout reserves exactly this width.
 */

import { estimateText, FONTS, type FontRole, type TextMeasure } from './metrics'

let context: CanvasRenderingContext2D | null | undefined
const cache = new Map<string, number>()

function fontFamily(mono: boolean): string {
  const style = getComputedStyle(document.documentElement)
  const family = style.getPropertyValue(mono ? '--font-mono' : '--font-sans').trim()
  return family || (mono ? 'monospace' : 'system-ui, sans-serif')
}

export const measureText: TextMeasure = (text: string, role: FontRole) => {
  if (typeof document === 'undefined') return estimateText(text, role)
  context ??= document.createElement('canvas').getContext('2d')
  if (!context) return estimateText(text, role)
  const font = FONTS[role]
  const key = `${role}\u0000${text}`
  const known = cache.get(key)
  if (known !== undefined) return known
  context.font = `${font.weight} ${font.size}px ${fontFamily(font.mono === true)}`
  const width = Math.ceil(context.measureText(text).width)
  cache.set(key, width)
  return width
}
