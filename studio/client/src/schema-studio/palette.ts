/**
 * Canvas palette + metrics.
 *
 * Modules carry a hue so a reader can tell two boxes apart at a glance; every
 * tint is derived here so the canvas stays legible on both themes and a single
 * change repaints it. Node metrics live here too because the layout engine must
 * reserve exactly what the DOM renders — a mismatch is what makes a graph look
 * full of holes.
 */

interface ModuleTint {
  /** module box fill */
  surface: string
  /** module box border */
  border: string
  /** module label */
  text: string
  /** the class node's leading bar + icon */
  mark: string
  /** selected card fill — the same hue, barely there, but unmistakably not neutral */
  wash: string
}

type Part = keyof ModuleTint
/** lightness + chroma per part; the hue comes from the module. */
type Tone = [number, number]
const TONES: Record<'light' | 'dark', Record<Part, Tone>> = {
  light: {
    surface: [0.977, 0.014],
    border: [0.875, 0.04],
    text: [0.46, 0.09],
    mark: [0.58, 0.12],
    wash: [0.985, 0.022],
  },
  dark: {
    surface: [0.245, 0.022],
    border: [0.345, 0.04],
    text: [0.8, 0.07],
    mark: [0.74, 0.11],
    wash: [0.28, 0.035],
  },
}

const PARTS: Part[] = ['surface', 'border', 'text', 'mark', 'wash']

const tone = ([lightness, chroma]: Tone, hue: number) => `oklch(${lightness} ${chroma} ${hue})`

/**
 * Tint for a module hue, as `light-dark()` pairs: the browser picks the side, so a
 * theme switch repaints without re-rendering.
 */
export function moduleTint(hue: number): ModuleTint {
  const paint = (part: Part) =>
    `light-dark(${tone(TONES.light[part], hue)}, ${tone(TONES.dark[part], hue)})`
  return Object.fromEntries(PARTS.map((part) => [part, paint(part)])) as unknown as ModuleTint
}

/** Room the canvas's floating toolbars take at the top of a view: nothing docks under them. */
export const TOOLBAR_CLEARANCE = 44

/** Room the floating agent dock takes at the bottom of a view: canvas controls sit above it. */
export const DOCK_CLEARANCE = 88
