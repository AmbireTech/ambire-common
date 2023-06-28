export default class EventEmitter {
  private callbacks: (() => void)[] = []

  private emitUpdate() {
    for (const cb of this.callbacks) cb()
  }

  // returns an unsub function
  onUpdate(cb: () => void): () => void {
    this.callbacks.push(cb)
    return () => this.callbacks.splice(this.callbacks.indexOf(cb), 1)
  }
}
