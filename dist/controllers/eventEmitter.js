"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class EventEmitter {
    constructor() {
        this.callbacks = [];
    }
    emitUpdate() {
        for (const cb of this.callbacks)
            cb();
    }
    // returns an unsub function
    onUpdate(cb) {
        this.callbacks.push(cb);
        return () => this.callbacks.splice(this.callbacks.indexOf(cb), 1);
    }
}
exports.default = EventEmitter;
//# sourceMappingURL=eventEmitter.js.map