import type { HarnessStatus } from '@shared/types'
import type { Dispatch, SetStateAction } from 'react'
import type { Root } from 'react-dom/client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterAll, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, useState } from 'react'

import { CLAUDE_CAPABILITIES } from '../../../../server/agent/harness/claude/capabilities'
import { CODEX_CAPABILITIES } from '../../../../server/agent/harness/codex/capabilities'
import { AgentSettings } from './agent'
import { AgentModel, CUSTOM_MODEL_OPTION } from './agent-model'

const noopSetter: Dispatch<SetStateAction<Record<string, string>>> = () => {}
const browser = new Window({ url: 'http://localhost' })
const originalGlobals = new Map<string, PropertyDescriptor | undefined>()

for (const [name, value] of Object.entries({
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLSelectElement: browser.HTMLSelectElement,
  Event: browser.Event,
  MouseEvent: browser.MouseEvent,
})) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
  writable: true,
})

const { createRoot } = await import('react-dom/client')
const { renderToStaticMarkup } = await import('react-dom/server')

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete (globalThis as Record<string, unknown>)[name]
  }
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT
})

function mount(node: React.ReactNode): { container: HTMLDivElement; root: Root } {
  const element = browser.document.createElement('div')
  browser.document.body.append(element)
  const container = element as unknown as HTMLDivElement
  const root = createRoot(container)
  act(() => root.render(node))
  return { container, root }
}

function unmount(root: Root, container: HTMLDivElement): void {
  act(() => root.unmount())
  container.remove()
}

function changeSelect(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value
    select.dispatchEvent(new browser.Event('change', { bubbles: true }) as unknown as Event)
  })
}

function changeInput(input: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new browser.Event('input', { bubbles: true }) as unknown as Event)
    input.dispatchEvent(new browser.Event('change', { bubbles: true }) as unknown as Event)
  })
}

function click(button: HTMLButtonElement): void {
  act(() =>
    button.dispatchEvent(
      new browser.MouseEvent('click', { bubbles: true }) as unknown as MouseEvent,
    ),
  )
}

const claudeHarness: HarnessStatus = {
  id: 'claude',
  label: 'Claude Code (local)',
  bin: 'claude',
  ok: true,
  version: 'test',
  message: 'Detected',
  options: [{ id: 'claude', label: 'Claude Code (local)' }],
  locked: false,
  source: 'domain',
  capabilities: CLAUDE_CAPABILITIES,
}

const harnessOptions = [
  { id: 'claude', label: 'Claude Code (local)' },
  { id: 'codex', label: 'Codex (local)' },
]

const codexHarness: HarnessStatus = {
  id: 'codex',
  label: 'Codex (local)',
  bin: 'codex',
  ok: true,
  version: 'test',
  message: 'Detected',
  options: harnessOptions,
  locked: false,
  source: 'domain',
  capabilities: {
    ...CODEX_CAPABILITIES,
    modelOptions: [{ id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' }],
  },
}

test('Claude capabilities reach the settings selector and native max button', () => {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <AgentSettings
        harness={claudeHarness}
        values={{ agentEffort: 'max' }}
        setValues={noopSetter}
        agentModels={{ claude: 'opus' }}
        setAgentModels={noopSetter}
      />
    </QueryClientProvider>,
  )

  for (const label of ['Fable', 'Sonnet', 'Opus', 'Custom model ID']) expect(html).toContain(label)
  expect(html).toMatch(/<option(?=[^>]*value="opus")(?=[^>]*selected="")[^>]*>Opus<\/option>/)
  expect(html).toMatch(
    /<button(?=[^>]*value="max")(?=[^>]*aria-checked="true")[^>]*>Ultra<\/button>/,
  )
})

test('custom model selection clears aliases, accepts an ID, and exits cleanly', () => {
  function Fixture() {
    const [model, setModel] = useState('opus')
    return (
      <>
        <AgentModel
          selected={model}
          modelOptions={CLAUDE_CAPABILITIES.modelOptions}
          allowCustomModel={CLAUDE_CAPABILITIES.allowCustomModel}
          onChange={setModel}
        />
        <output aria-label="Selected model">{model || 'default'}</output>
      </>
    )
  }

  const { container, root } = mount(<Fixture />)
  try {
    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Agent model"]',
    )!
    expect(modelSelect.value).toBe('opus')

    changeSelect(modelSelect, CUSTOM_MODEL_OPTION)
    const customInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom model ID"]',
    )!
    expect(customInput).toBeTruthy()
    expect(customInput.value).toBe('')
    expect(container.querySelector('output')?.textContent).toBe('default')

    changeInput(customInput, 'claude-fable-5')
    expect(container.querySelector('output')?.textContent).toBe('claude-fable-5')
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Custom model ID"]')?.value,
    ).toBe('claude-fable-5')

    changeSelect(modelSelect, 'sonnet')
    expect(container.querySelector('output')?.textContent).toBe('sonnet')
    expect(container.querySelector('input[aria-label="Custom model ID"]')).toBeNull()

    changeSelect(modelSelect, '')
    expect(container.querySelector('output')?.textContent).toBe('default')
    expect(container.querySelector('input[aria-label="Custom model ID"]')).toBeNull()
  } finally {
    unmount(root, container)
  }
})

test('a persisted custom Claude model reopens the editable custom-model path', () => {
  const html = renderToStaticMarkup(
    <AgentModel
      selected="claude-fable-5"
      modelOptions={CLAUDE_CAPABILITIES.modelOptions}
      allowCustomModel={CLAUDE_CAPABILITIES.allowCustomModel}
      onChange={() => {}}
    />,
  )

  expect(html).toMatch(/<option value="__custom_model__" selected="">Custom model ID…<\/option>/)
  expect(html).toMatch(/<input[^>]*aria-label="Custom model ID"[^>]*value="claude-fable-5"[^>]*\/>/)
})

test('harness switching isolates custom mode and restores native effort labels', () => {
  function Fixture() {
    const [harnessId, setHarnessId] = useState<'claude' | 'codex'>('claude')
    const [values, setValues] = useState<Record<string, string>>({ agentEffort: 'high' })
    const [agentModels, setAgentModels] = useState<Record<string, string>>({
      claude: 'opus',
      codex: 'gpt-5.4-mini',
    })
    const harness =
      harnessId === 'claude'
        ? { ...claudeHarness, options: harnessOptions }
        : { ...codexHarness, options: harnessOptions }
    return (
      <QueryClientProvider client={new QueryClient()}>
        <button
          type="button"
          aria-label="Switch to Claude"
          onClick={() => setHarnessId('claude')}
        />
        <button type="button" aria-label="Switch to Codex" onClick={() => setHarnessId('codex')} />
        <output aria-label="Selected effort">{values.agentEffort}</output>
        <AgentSettings
          harness={harness}
          values={values}
          setValues={setValues}
          agentModels={agentModels}
          setAgentModels={setAgentModels}
        />
      </QueryClientProvider>
    )
  }

  const { container, root } = mount(<Fixture />)
  try {
    click(container.querySelector<HTMLButtonElement>('button[value="max"]')!)
    expect(container.querySelector('output[aria-label="Selected effort"]')?.textContent).toBe('max')
    expect(container.querySelector('button[value="max"]')?.textContent).toBe('Ultra')

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Agent model"]',
    )!
    changeSelect(modelSelect, CUSTOM_MODEL_OPTION)
    expect(container.querySelector('input[aria-label="Custom model ID"]')).toBeTruthy()

    click(container.querySelector<HTMLButtonElement>('button[aria-label="Switch to Codex"]')!)
    const codexModel = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Agent model"]',
    )!
    expect(codexModel.value).toBe('gpt-5.4-mini')
    expect(container.querySelector('input[aria-label="Custom model ID"]')).toBeNull()
    expect(container.querySelector('button[value="xhigh"]')?.getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(container.querySelector('button[value="xhigh"]')?.textContent).toBe('X-high')

    click(container.querySelector<HTMLButtonElement>('button[aria-label="Switch to Claude"]')!)
    const restoredClaude = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Agent model"]',
    )!
    expect(restoredClaude.value).toBe('')
    expect(container.querySelector('input[aria-label="Custom model ID"]')).toBeNull()
    expect(container.querySelector('button[value="max"]')?.getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(container.querySelector('button[value="max"]')?.textContent).toBe('Ultra')
  } finally {
    unmount(root, container)
  }
})
