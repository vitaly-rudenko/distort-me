type Callback = () => Promise<void>

export class Queue {
  private pending: Callback[] = []
  private promise = Promise.resolve()
  private limit: number

  constructor(options: { limit: number }) {
    this.limit = options.limit
  }

  enqueue(callback: () => Promise<void>): boolean {
    if (this.pending.length >= this.limit) {
      return false
    }

    this.pending.push(callback)
    this.promise = this.promise.then(() => this.take())

    return true
  }

  private async take() {
    const callback = this.pending.shift()
    if (!callback) return

    await callback()
  }
}
