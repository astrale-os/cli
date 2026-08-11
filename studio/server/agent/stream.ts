/** Lifecycle-safe NDJSON writer for cancellable agent response streams. */
export class NdjsonChannel {
  private readonly encoder = new TextEncoder()
  private closed = false

  constructor(
    private readonly target: ReadableStreamDefaultController<Uint8Array>,
    private readonly abortController: AbortController,
  ) {}

  send(value: unknown): boolean {
    if (this.closed) return false
    try {
      this.target.enqueue(this.encoder.encode(`${JSON.stringify(value)}\n`))
      return true
    } catch {
      this.cancel()
      return false
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.target.close()
    } catch {
      /* client already canceled */
    }
  }

  cancel(): void {
    if (this.closed) return
    this.closed = true
    this.abortController.abort()
  }
}
