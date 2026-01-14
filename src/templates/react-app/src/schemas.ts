/**
 * Zod Schemas
 *
 * Reusable schemas for metadata and data.
 */

import { z } from "zod"

// Example: Item metadata
export const ItemMeta = z.object({
  title: z.string(),
  createdAt: z.string(),
})

export type ItemMeta = z.infer<typeof ItemMeta>

// Example: Item data
export const ItemData = z.object({
  content: z.string(),
})

export type ItemData = z.infer<typeof ItemData>
