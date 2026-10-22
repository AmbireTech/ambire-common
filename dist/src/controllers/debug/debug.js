"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DebugController = void 0;
const tslib_1 = require("tslib");
const debugLogger_1 = require("../../libs/debugLogger/debugLogger");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
/**
 * Enables/disables per-controller debug logging at runtime. Logging settings
 * are persisted in storage and reloaded at startup.
 */
class DebugController extends eventEmitter_1.default {
    #storage;
    #unsubscribeFromRegistry;
    initialLoadPromise;
    constructor(storage, eventEmitterRegistry) {
        super(eventEmitterRegistry);
        this.#storage = storage;
        // Re-emit when a new namespace registers, so dynamically-constructed controllers
        // (e.g. SignAccountOpController) appear in the UI the moment they're created
        this.#unsubscribeFromRegistry = debugLogger_1.debugLoggerRegistry.subscribe(() => this.emitUpdate());
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    async #load() {
        const stored = await this.#storage.get('debugLogNamespaces', {});
        debugLogger_1.debugLoggerRegistry.hydrate(stored);
        this.emitUpdate();
    }
    /**
     * Full catalog of toggleable controllers with their on/off state (for the UI)
     */
    get namespaces() {
        return debugLogger_1.debugLoggerRegistry
            .catalog()
            .map((name) => ({ name, enabled: debugLogger_1.debugLoggerRegistry.isEnabled(name) }));
    }
    async setNamespaceEnabled(namespace, value) {
        debugLogger_1.debugLoggerRegistry.setEnabled(namespace, value);
        this.emitUpdate();
        await this.#storage.set('debugLogNamespaces', debugLogger_1.debugLoggerRegistry.snapshot());
    }
    destroy() {
        this.#unsubscribeFromRegistry();
        super.destroy();
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            namespaces: this.namespaces
        };
    }
}
exports.DebugController = DebugController;
//# sourceMappingURL=debug.js.map