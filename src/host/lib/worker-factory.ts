/**
 * Browser Worker Factory
 *
 * Creates Web Workers for background app workers.
 * Uses Blob URLs to work around cross-origin restrictions.
 */

export interface WorkerApp {
  appId: string
  workerUrl: string
  metadata?: unknown
}

export interface WorkerInstance {
  appId: string
  status: string
  startedAt: string
  lastActivityAt: string
  metadata: unknown
  terminate: () => Promise<void>
}

export type WorkerFactory = (opts: { app: WorkerApp; port: MessagePort }) => Promise<WorkerInstance>

/**
 * Creates a worker factory for browser environments.
 * Uses the shell's MSG constants for control messages.
 *
 * To work around cross-origin restrictions, we fetch the worker script
 * and create a Blob URL that imports it.
 */
export function createBrowserWorkerFactory(
  wrapControl: (msg: { type: string; payload: unknown }) => unknown,
  initPortType: string,
  onLog?: (message: string, level: 'info' | 'error') => void,
): WorkerFactory {
  return async ({ app, port }) => {
    onLog?.(`Creating worker for ${app.appId}`, 'info')

    // Create a Blob URL that imports the worker script
    // This works around cross-origin restrictions for Web Workers
    const workerCode = `import "${app.workerUrl}";`
    const blob = new Blob([workerCode], { type: 'application/javascript' })
    const blobUrl = URL.createObjectURL(blob)

    let worker: Worker
    try {
      worker = new Worker(blobUrl, { type: 'module' })
    } finally {
      // Revoke the blob URL after worker is created (worker keeps reference)
      URL.revokeObjectURL(blobUrl)
    }

    // Transfer the MessagePort to the worker
    worker.postMessage(wrapControl({ type: initPortType, payload: {} }), [port])
    onLog?.('Port transferred to worker', 'info')

    worker.onerror = (err) => {
      onLog?.(`Worker error: ${err.message}`, 'error')
    }

    return {
      appId: app.appId,
      status: 'ready',
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      metadata: app.metadata ?? {},
      terminate: async () => {
        worker.terminate()
        onLog?.(`Worker ${app.appId} terminated`, 'info')
      },
    }
  }
}
