import { createIframeShellAdapter, createShell, requestIntent } from '@astrale-os/shell'

const shell = createShell({ mode: 'sandboxed', adapter: createIframeShellAdapter() })
await shell.init()
document.body.innerHTML = `<button id="select">Select issues</button><output id="status">ready</output>`
const status = document.querySelector('output')!
document.querySelector('#select')!.addEventListener('click', () => {
  status.textContent = 'asking'
  requestIntent(shell.parent!, 'graph.select', { title: 'Link issues', maximum: 2 }).then(
    (result) => {
      status.textContent = [result.outcome, ...result.nodes.map((node) => node.name)].join(' ')
    },
    (error: unknown) => {
      status.textContent = `error ${error instanceof Error ? error.message : String(error)}`
    },
  )
})
