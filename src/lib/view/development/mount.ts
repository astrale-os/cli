import type { MountedWindow, MountParams, Shell, ViewTransport } from '@astrale-os/shell'

import { developmentTransportFor } from './transport'

/** Mount through the proven local transport only when this exact route can reuse it. */
export function openDevelopmentView(
  shell: Pick<Shell, 'openView'>,
  params: Omit<MountParams, 'transport'>,
  witness: ViewTransport | undefined,
): Promise<MountedWindow> {
  return shell.openView({
    ...params,
    transport: developmentTransportFor(params.view, witness),
  })
}
