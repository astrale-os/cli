/**
 * Derived Types
 *
 * Types inferred from the app definition.
 */

import type { ModuleOf } from "@astrale/react"

import type { App } from "./schema"

export type Item = ModuleOf<typeof App, "ITEM">

export type AppType = typeof App
