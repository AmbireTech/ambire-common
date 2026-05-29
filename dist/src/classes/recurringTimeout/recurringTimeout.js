// Execute `fn` at a specific interval, ensuring that the current invocation of `fn`
// completes before the next one starts. This serves as an alternative to `setInterval`,
// but providing protection against overlapping invocations of `fn`. It also includes
// debounce logic so that redundant start/restart calls within the same tick are collapsed.
export class RecurringTimeout {
    #id; // for debugging
    #timeoutId;
    #emitError;
    #fn;
    // used mainly for testing how many times the fn was called
    sessionId = 0;
    fnExecutionsCount = 0;
    running = false;
    startedRunningAt = 0;
    currentTimeout;
    promise;
    // collapse multiple start/restart calls in the same tick
    #pendingStart;
    // we use this id to prevent race conditions where a background-queued 12s wait
    // would block a foreground-queued immediate execution in the same tick.
    #internalSessionId = 0;
    startScheduled = false;
    constructor(fn, timeout, emitError, id) {
        this.#fn = fn;
        this.currentTimeout = timeout;
        this.#emitError = emitError;
        this.#id = id;
    }
    updateTimeout({ timeout }) {
        this.currentTimeout = timeout;
    }
    start(opts = {}) {
        this.#scheduleStart(opts);
    }
    stop() {
        this.#internalSessionId += 1;
        this.sessionId = this.#internalSessionId;
        this.startScheduled = false;
        this.#reset();
    }
    restart(opts = {}) {
        this.#internalSessionId += 1;
        this.sessionId = this.#internalSessionId;
        this.#reset();
        this.#scheduleStart(opts);
    }
    async #loop() {
        this.fnExecutionsCount += 1;
        const currentCount = this.fnExecutionsCount;
        try {
            this.promise = this.#fn();
            await this.promise;
        }
        catch (err) {
            if (!this.promise)
                return;
            console.error('Recurring task error:', err);
            if (this.#emitError) {
                // set level to silent as we don't want the user to see 'Recurring task failed'
                this.#emitError({ error: err, message: 'Recurring task failed', level: 'silent' });
            }
        }
        finally {
            // If fnExecutionsCount has changed, it means `restart` was called during the execution of fn,
            // so we shouldn't schedule the next loop here.
            if (this.promise && this.fnExecutionsCount === currentCount) {
                if (this.running)
                    this.#timeoutId = setTimeout(this.#loop.bind(this), this.currentTimeout);
                this.promise = undefined;
            }
        }
    }
    #scheduleStart(opts = {}) {
        if (this.running)
            return;
        this.#pendingStart = {
            timeout: opts.timeout ?? this.#pendingStart?.timeout,
            runImmediately: opts.runImmediately || this.#pendingStart?.runImmediately,
            allowOverlap: opts.allowOverlap || this.#pendingStart?.allowOverlap
        };
        if (this.startScheduled)
            return;
        this.startScheduled = true;
        const capturedSessionId = this.#internalSessionId;
        queueMicrotask(() => {
            // If the session ID changed since we queued this microtask (e.g. stop() or restart() was called),
            // we self-destruct. This prevents a background-scheduled "wait" from blocking an immediate request.
            if (this.#internalSessionId !== capturedSessionId)
                return;
            this.startScheduled = false;
            const { timeout: newTimeout, runImmediately, allowOverlap } = this.#pendingStart || {};
            this.#pendingStart = undefined;
            this.running = true;
            this.startedRunningAt = Date.now();
            if (newTimeout)
                this.updateTimeout({ timeout: newTimeout });
            // Prevents starting a new loop if the previous one is still running
            if (this.promise && !allowOverlap)
                return;
            if (runImmediately) {
                this.#loop();
            }
            else {
                this.#timeoutId = setTimeout(this.#loop.bind(this), this.currentTimeout);
            }
        });
    }
    #reset() {
        this.running = false;
        this.startScheduled = false;
        this.promise = undefined;
        if (this.#timeoutId) {
            clearTimeout(this.#timeoutId);
            this.#timeoutId = undefined;
        }
    }
}
//# sourceMappingURL=recurringTimeout.js.map