"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const uuid_1 = require("uuid");
const debugLogger_1 = require("../../libs/debugLogger/debugLogger");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const LIMIT_ON_THE_NUMBER_OF_ERRORS = 100;
// Can be overwritten by controllers to narrow the flow tags for better console filtering and type safety.
class EventEmitter {
    id;
    #registry = null;
    #callbacksWithId = [];
    #callbacks = [];
    #errorCallbacksWithId = [];
    #errorCallbacks = [];
    #errors = [];
    // Trailing throttle used by `emitUpdate({ throttleMs })`
    #throttleTimeout = null;
    #hasTrailingUpdate = false;
    statuses = {};
    /**
     *
     * @param registry - EventEmitterRegistryController instance to be used by this controller. Controllers
     * added to the registry will have their updates and errors propagated to the front-end.
     * @param registerImmediately - Most of the time we want to register the controller in the registry
     * immediately upon construction. However, there are some dynamic controllers (like SignAccountOpController)
     * that should be registered only after a condition is met (e.g. when the request is open)
     */
    constructor(registry, registerImmediately = true) {
        this.id = (0, uuid_1.v4)();
        // Register the controller on construction
        debugLogger_1.debugLoggerRegistry.registerNamespace(this.name);
        if (registry) {
            this.#registry = registry;
            if (registerImmediately) {
                this.registerInRegistry();
            }
        }
    }
    get name() {
        return this.constructor.name;
    }
    get onUpdateIds() {
        return this.#callbacksWithId.map((item) => item.id);
    }
    get onErrorIds() {
        return this.#errorCallbacksWithId.map((item) => item.id);
    }
    // called emittedErrors and not just errors because some of the other controllers
    // that extend this one have errors defined already
    get emittedErrors() {
        return this.#errors;
    }
    /**
     * Emits an update immediately, bypassing both background batching
     * (where updates on the same tick are debounced and batched for performance)
     * and React batching (where rapid state updates are merged).
     *
     * This ensures the state change is applied instantly at the React application level.
     * It is especially useful when multiple status flags change in quick succession.
     *
     * For example, if a flow updates a status from INITIAL -> LOADING -> SUCCESS -> INITIAL,
     * normal batching may skip intermediate states and only emit the first and last ones.
     */
    async forceEmitUpdate() {
        // An immediate emit supersedes any pending throttled update
        this.#clearThrottle();
        // Bypassing background batching on the same tick
        await (0, wait_1.default)(1);
        // Passing `true` to the cb will bypass React batching
        this.#doEmit(true);
    }
    #doEmit(forceEmit) {
        for (const i of this.#callbacksWithId)
            i.cb(forceEmit);
        for (const cb of this.#callbacks)
            cb(forceEmit);
    }
    #clearThrottle() {
        if (this.#throttleTimeout !== null) {
            clearTimeout(this.#throttleTimeout);
            this.#throttleTimeout = null;
        }
        this.#hasTrailingUpdate = false;
    }
    #openThrottleWindow(throttleMs) {
        this.#throttleTimeout = setTimeout(() => {
            // Keep throttling as long as updates keep arriving; stop once a window
            // passes with nothing pending so an idle controller holds no timer.
            if (this.#hasTrailingUpdate) {
                this.#hasTrailingUpdate = false;
                this.#doEmit();
                this.#openThrottleWindow(throttleMs);
            }
            else {
                this.#throttleTimeout = null;
            }
        }, throttleMs);
    }
    /**
     * Emits an update to all subscribers.
     *
     * Pass `throttleMs` for high-frequency background updates (e.g. portfolio
     * ticks) that don't need to reach the UI on every single change. The first
     * emit fires immediately, while further throttled emits within the
     * window are coalesced into a single trailing emit that carries the latest
     * state. A plain `emitUpdate()` or `forceEmitUpdate()` in the meantime flushes
     * the pending update instantly, so user interactions are never delayed.
     */
    emitUpdate(options) {
        const throttleMs = options?.throttleMs ?? 0;
        if (throttleMs <= 0) {
            // An immediate emit supersedes any pending throttled update
            this.#clearThrottle();
            this.#doEmit();
            return;
        }
        // Leading edge: emit now and open the throttle window
        if (this.#throttleTimeout === null) {
            this.#doEmit();
            this.#openThrottleWindow(throttleMs);
            return;
        }
        // Within the window: defer to a single trailing emit
        this.#hasTrailingUpdate = true;
    }
    /**
     * Propagates updates from a child controller to its parent in a parent -> child setup,
     * ensuring child state updates reach the application without being lost due to batching.
     *
     * Used when a parent controller (e.g. swapAndBridgeController) subscribes to child updates:
     *
     *   this.#signAccountOpController.onUpdate((forceEmit) => {
     *     this.propagateUpdate(forceEmit)
     *   })
     *
     * Child controllers may update their status very quickly
     * (e.g. INITIAL -> LOADING -> SUCCESS -> INITIAL).
     * If the parent propagates these updates via `forceEmitUpdate()`,
     * the update is scheduled in a new tick and intermediate states may be lost.
     *
     * `propagateUpdate` forwards the update in the same tick while preserving the
     * `forceEmit` behavior, ensuring all states are correctly propagated.
     *
     * Notes:
     *  - If `forceEmit` is falsy, this behaves the same as calling `emitUpdate()`.
     *    For consistency and clarity, parent -> child setups should always use
     *    `propagateUpdate()` instead of mixing `emitUpdate()` and `propagateUpdate()`.
     *
     *  -  For all direct controller updates (i.e. when there is no child controller involved
     *     and the controller updates its own state), use `emitUpdate()` or `forceEmitUpdate()`.
     */
    propagateUpdate(forceEmit) {
        // An immediate emit supersedes any pending throttled update
        this.#clearThrottle();
        this.#doEmit(forceEmit);
    }
    /** True when this controller's debug logging is toggled on. */
    get isDebugLogEnabled() {
        return debugLogger_1.debugLoggerRegistry.isEnabled(this.name);
    }
    /** Per-controller gated debug log. No-op unless this controller's namespace is
     *  toggled on via DebugController. */
    debugLog(flow, message, payload, options) {
        (0, debugLogger_1.debugLog)(this.name, flow, message, payload, options);
    }
    emitError(error) {
        this.#errors.push(error);
        this.#trimErrorsIfNeeded();
        console.log(`[Еmitted error in controller ${this.constructor.name}] ${error.message}`, this.#errors);
        for (const i of this.#errorCallbacksWithId)
            i.cb(error);
        for (const cb of this.#errorCallbacks)
            cb(error);
    }
    async withStatus(callName, fn, allowConcurrentActions = false, 
    // Silence this error in prod to avoid displaying wired error messages.
    // The only benefit of displaying it is for devs to see when an action is dispatched twice.
    // TODO: If this happens on PROD, ideally we should get an error report somehow somewhere.
    errorLevel = process.env.APP_ENV === 'production' &&
        process.env.IS_TESTING !== 'true'
        ? 'silent'
        : 'minor') {
        const someStatusIsLoading = Object.values(this.statuses).some((status) => status !== 'INITIAL');
        if (!this.statuses[callName]) {
            console.error(`${callName} is not defined in "statuses".`);
        }
        // By default, concurrent actions are disallowed to maintain consistency, particularly within sub-controllers where
        // simultaneous actions can lead to unintended side effects. The 'allowConcurrentActions' flag is provided to enable
        // concurrent execution at the main controller level. This is useful when multiple actions need to modify the state
        // of different sub-controllers simultaneously.
        if ((someStatusIsLoading && !allowConcurrentActions) ||
            !['INITIAL', 'SUCCESS'].includes(this.statuses[callName])) {
            this.emitError({
                level: errorLevel,
                message: `Please wait for the completion of the previous action before initiating another one, ${callName}`,
                error: new Error('Another function is already being handled by withStatus refrain from invoking a second function.')
            });
            return;
        }
        if (this.statuses[callName] === 'SUCCESS') {
            await (0, wait_1.default)(2); // to let the INITIAL status be fired from the prev session
        }
        this.statuses[callName] = 'LOADING';
        await this.forceEmitUpdate();
        try {
            await fn();
            this.statuses[callName] = 'SUCCESS';
            await this.forceEmitUpdate();
        }
        catch (error) {
            this.statuses[callName] = 'ERROR';
            if ('message' in error && 'level' in error && 'error' in error) {
                this.emitError(error);
                // Sometimes we don't want to show an error message to the user. For example, if the user cancels a request
                // we don't want to go through the SUCCESS state, but we also don't want to show an error message.
            }
            else if (error?.message) {
                this.emitError({
                    message: error?.message || 'An unexpected error occurred',
                    level: 'major',
                    error
                });
            }
            await this.forceEmitUpdate();
        }
        this.statuses[callName] = 'INITIAL';
        await this.forceEmitUpdate();
    }
    // Prevents memory leaks and storing huge amount of errors
    #trimErrorsIfNeeded() {
        if (this.#errors.length > LIMIT_ON_THE_NUMBER_OF_ERRORS) {
            const excessErrors = this.#errors.length - LIMIT_ON_THE_NUMBER_OF_ERRORS;
            this.#errors = this.#errors.slice(excessErrors);
        }
    }
    // returns an unsub function
    onUpdate(cb, id) {
        if (id) {
            this.#callbacksWithId.push({ id, cb });
        }
        else {
            this.#callbacks.push(cb);
        }
        return () => {
            if (id) {
                this.#callbacksWithId = this.#callbacksWithId.filter((callbackItem) => callbackItem.id !== id);
            }
            else {
                this.#callbacks.splice(this.#callbacks.indexOf(cb), 1);
            }
        };
    }
    // returns an unsub function for error events
    onError(cb, id) {
        if (id) {
            this.#errorCallbacksWithId.push({ id, cb });
        }
        else {
            this.#errorCallbacks.push(cb);
        }
        return () => {
            if (id) {
                this.#errorCallbacksWithId = this.#errorCallbacksWithId.filter((callbackItem) => callbackItem.id !== id);
            }
            else {
                this.#errorCallbacks.splice(this.#errorCallbacks.indexOf(cb), 1);
            }
        };
    }
    /**
     * Destroys the controller, unregistering it from the EventEmitterRegistry and
     * clearing all callbacks and errors.
     */
    destroy() {
        this.#clearThrottle();
        this.unregisterFromRegistry();
        this.#callbacks = [];
        this.#callbacksWithId = [];
        this.#errorCallbacks = [];
        this.#errorCallbacksWithId = [];
        this.#errors = [];
    }
    /**
     * Registers the controller into the EventEmitterRegistry (if set)
     * to propagate its updates and errors to the front-end.
     */
    registerInRegistry() {
        if (!this.#registry) {
            this.emitError({
                level: 'silent',
                message: `EventEmitter: Trying to register a controller while the registry is not set. Controller: ${this.name}`,
                error: new Error('EventEmitter: Trying to register a controller while the registry is not set.')
            });
            return;
        }
        this.#registry.set(this.id, this);
    }
    /**
     * Unregisters the controller from the EventEmitterRegistry (if set).
     * Used when controllers are destroyed or by dynamic controllers.
     */
    unregisterFromRegistry() {
        if (!this.#registry)
            return;
        this.#registry?.delete(this.id);
    }
    isInRegistry() {
        return !!this.#registry?.has(this.id);
    }
    toJSON() {
        return {
            ...this,
            name: this.name,
            emittedErrors: this.emittedErrors // includes the getter in the stringified instance
        };
    }
}
exports.default = EventEmitter;
//# sourceMappingURL=eventEmitter.js.map