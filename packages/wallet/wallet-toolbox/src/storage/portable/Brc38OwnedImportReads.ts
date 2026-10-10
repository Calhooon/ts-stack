/** Internal I/O scope, never an authentication or destination authority token.
 * One bounded private read is physically drained before its actual owner can
 * release. An escaped facade cannot enqueue work after its callback settles. */
export class Brc38OwnedImportReads {
  #closed = false
  #pending: Promise<unknown> | undefined
  #failed = false
  #failure: unknown
  run<T>(read: () => Promise<T>): Promise<T> {
    if (this.#closed || this.#pending !== undefined || this.#failed) {
      const refusal = Promise.reject<T>(new Error('Owned private import read is unavailable or already pending'))
      void refusal.catch(() => undefined)
      return refusal
    }
    const job = Promise.resolve().then(read)
    this.#pending = job
    void job.then(
      () => {
        if (this.#pending === job) this.#pending = undefined
      },
      cause => {
        this.#failed = true
        this.#failure = cause
        if (this.#pending === job) this.#pending = undefined
      }
    )
    return job
  }
  async finish(): Promise<void> {
    this.#closed = true
    await this.#pending?.then(
      () => undefined,
      () => undefined
    )
    if (this.#failed) throw this.#failure
  }
  async retain<T>(work: () => Promise<T>): Promise<T> {
    let failed = false,
      cause: unknown,
      result: T | undefined
    try {
      result = await work()
    } catch (failure) {
      failed = true
      cause = failure
    }
    try {
      await this.finish()
    } catch (failure) {
      if (failed && failure !== cause)
        throw new AggregateError([cause, failure], 'Private import callback and owned read both failed')
      throw failure
    }
    if (failed) throw cause
    return result as T
  }
}
