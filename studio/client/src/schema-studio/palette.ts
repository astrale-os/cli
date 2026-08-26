/**
 * Canvas palette + metrics.
 *
 * Modules carry a hue so a reader can tell two boxes apart at a glance; every
 * tint is derived here so the canvas stays legible on the light surface and a
 * single change repaints it. Node metrics live here too because the layout
 * engine must reserve exactly what the DOM renders — a mismatch is what makes
 * a graph look full of holes.
 */

export interface ModuleTint {
  /** module box fill */
  surface: string
  /** module box border */
  border: string
  /** module label */
  text: string
  /** the class node's leading bar + icon */
  mark: string
}

export function moduleTint(hue: number): ModuleTint {
  return {
    surface: `oklch(0.977 0.014 ${hue})`,
    border: `oklch(0.875 0.04 ${hue})`,
    text: `oklch(0.46 0.09 ${hue})`,
    mark: `oklch(0.58 0.12 ${hue})`,
  }
}

/** Rendered size of a class node — the layout contract (see elk-layout.ts). */
export const CLASS_W = 184
export const CLASS_H = 40
/** Module box insets: children start below the header, padded on every side. */
export const MODULE_HEADER = 38
export const MODULE_PAD = 18
export const MODULE_COLLAPSED_H = 34
