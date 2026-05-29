// The EventEmitterRegistry controller maintains a map of all controllers
// for which onUpdate and onError listeners are registered to propagate FE state updates
export class EventEmitterRegistryController {
    #map = new Map();
    #onUpdate;
    constructor(onUpdate) {
        this.#onUpdate = onUpdate;
    }
    get size() {
        return this.#map.size;
    }
    get(id) {
        return this.#map.get(id);
    }
    values() {
        return Array.from(this.#map.values());
    }
    entries() {
        return Array.from(this.#map.entries());
    }
    set(id, ctrl) {
        this.#map.set(id, ctrl);
        this.#onUpdate();
    }
    delete(id) {
        const result = this.#map.delete(id);
        if (result)
            this.#onUpdate();
    }
    has(id) {
        return this.#map.has(id);
    }
    clear() {
        this.#map.clear();
        this.#onUpdate();
    }
    toJSON() {
        return {
            ...this,
            size: this.size
        };
    }
}
//# sourceMappingURL=eventEmitterRegistry.js.map