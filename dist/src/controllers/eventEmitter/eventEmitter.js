"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
/* eslint-disable no-restricted-syntax */
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const LIMIT_ON_THE_NUMBER_OF_ERRORS = 100;
class EventEmitter {
    #callbacksWithId = [];
    #callbacks = [];
    #errorCallbacksWithId = [];
    #errorCallbacks = [];
    #errors = [];
    statuses = {};
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
     * Using this function to emit an update bypasses both background and React batching,
     * ensuring that the state update is immediately applied at the application level (React/Extension).
     *
     * This is particularly handy when multiple status flags are being updated rapidly.
     * Without the `forceEmitUpdate` option, the application will only render the very first and last status updates,
     * batching the ones in between.
     */
    async forceEmitUpdate() {
        await (0, wait_1.default)(1);
        // eslint-disable-next-line no-restricted-syntax
        for (const i of this.#callbacksWithId)
            i.cb(true);
        // eslint-disable-next-line no-restricted-syntax
        for (const cb of this.#callbacks)
            cb(true);
    }
    emitUpdate() {
        // eslint-disable-next-line no-restricted-syntax
        for (const i of this.#callbacksWithId)
            i.cb();
        // eslint-disable-next-line no-restricted-syntax
        for (const cb of this.#callbacks)
            cb();
    }
    emitError(error) {
        this.#errors.push(error);
        this.#trimErrorsIfNeeded();
        console.log(`[Еmitted error in controller ${this.constructor.name}] ${error.message}`, this.#errors);
        // eslint-disable-next-line no-restricted-syntax
        for (const i of this.#errorCallbacksWithId)
            i.cb(error);
        // eslint-disable-next-line no-restricted-syntax
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
        if ((someStatusIsLoading && !allowConcurrentActions) || this.statuses[callName] !== 'INITIAL') {
            this.emitError({
                level: errorLevel,
                message: `Please wait for the completion of the previous action before initiating another one.', ${callName}`,
                error: new Error('Another function is already being handled by withStatus refrain from invoking a second function.')
            });
            return;
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
    toJSON() {
        return {
            ...this,
            emittedErrors: this.emittedErrors // includes the getter in the stringified instance
        };
    }
}
exports.default = EventEmitter;
//# sourceMappingURL=eventEmitter.js.map