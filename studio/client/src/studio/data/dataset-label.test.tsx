import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { TooltipProvider } from '@/components/ui/tooltip'

import { DatasetLabel } from './dataset-label'

const label = (name: string) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <DatasetLabel name={name} origin="desk.example.dev" />
    </TooltipProvider>,
  )

test("the label names the open dataset beside the dataset's glyph, in the Data accent", () => {
  const html = label('Support desk')
  const button = /<button[^>]*data-testid="dataset-label"[^>]*>.*?<\/button>/.exec(html)?.[0]
  expect(button).toBeDefined()
  expect(button).toContain('text-primary')
  expect(button).toContain('lucide-database')
  expect(button).toContain('<span class="truncate">Support desk</span>')
  // the way to every dataset of the Domain: a button, not a menu of them
  expect(button).not.toContain('aria-haspopup')
  expect(button).toContain('lucide-layout-grid')
})

test('a long name gives way, and the label keeps its place', () => {
  const html = label('A dataset whose title runs longer than the canvas corner it stands in')
  expect(html).toContain('max-w-72')
  expect(html).toContain('class="truncate"')
})
