/** The pictogram each built-in glyph draws, on the canvas and in the Index alike. */

import {
  AppWindow,
  Box,
  CircleDashed,
  ClipboardCheck,
  Eye,
  GitFork,
  Globe,
  KeyRound,
  Layers,
  ListChecks,
  ListTodo,
  type LucideIcon,
  PencilLine,
  Plug,
  Ruler,
  Search,
  ShieldCheck,
  Spline,
  SquareFunction,
  Workflow,
} from 'lucide-react'

import type { LensOptionIcon, SceneGlyph } from '../scene/types'

export const GLYPHS: Record<SceneGlyph, LucideIcon> = {
  class: Box,
  relationship: Spline,
  function: SquareFunction,
  mutation: PencilLine,
  integration: Plug,
  identity: KeyRound,
  view: AppWindow,
  module: Layers,
  policy: ShieldCheck,
  constraint: ListChecks,
  precondition: ClipboardCheck,
  scenario: ListTodo,
  query: Search,
  measure: Ruler,
}

/** The pictogram each lens option's toggle wears: what turning it on draws. */
export const OPTION_GLYPHS: Record<LensOptionIcon, LucideIcon> = {
  domains: Globe,
  inheritance: GitFork,
  unwritten: CircleDashed,
  mutations: PencilLine,
  reads: Eye,
  calls: Workflow,
}
