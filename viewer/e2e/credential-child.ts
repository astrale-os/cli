import { createShell, createIframeShellAdapter } from '@astrale-os/shell'

const shell = createShell({ mode: 'sandboxed', adapter: createIframeShellAdapter() })
await shell.init()
document.body.innerHTML =
  '<label>Draft <textarea></textarea></label><output data-refreshes="0">ready</output>'
const output = document.querySelector('output')!
output.dataset.caller = (await shell.self()).id
output.dataset.revision = await shell.schemaRevision()
let refreshes = 0
shell.onMessage((message, direction) => {
  if (
    direction === 'inbound' &&
    message.type === 'ctrl' &&
    message.action === 'credentialRefresh'
  ) {
    document.querySelector('output')!.dataset.refreshes = String(++refreshes)
  }
})
