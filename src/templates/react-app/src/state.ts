/**
 * Window State
 *
 * Per-window UI state schema and initial values.
 */

import { z } from "zod"

export const WindowState = z.object({
  selectedId: z.string().nullable(),
})

export type WindowState = z.infer<typeof WindowState>

export const initialWindowState: WindowState = {
  selectedId: null,
}
