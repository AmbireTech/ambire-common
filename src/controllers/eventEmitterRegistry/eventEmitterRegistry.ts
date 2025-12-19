import EventEmitter from '../eventEmitter/eventEmitter'

export class EventEmitterRegistryController {
  #map = new Map<string, EventEmitter>()

  #onUpdate: () => void

  constructor(onUpdate: () => void) {
    this.#onUpdate = onUpdate
  }

  get size() {
    return this.#map.size
  }

  get(id: string) {
    return this.#map.get(id)
  }

  values(): EventEmitter[] {
    return Array.from(this.#map.values())
  }

  entries(): [string, EventEmitter][] {
    return Array.from(this.#map.entries())
  }

  set(id: string, ctrl: EventEmitter) {
    this.#map.set(id, ctrl)

    this.#onUpdate()
  }

  delete(id: string) {
    const result = this.#map.delete(id)
    if (result) this.#onUpdate()
  }

  has(id: string) {
    return this.#map.has(id)
  }

  clear() {
    this.#map.clear()
    this.#onUpdate()
  }

  toJSON() {
    return {
      ...this,
      size: this.size
    }
  }
}
