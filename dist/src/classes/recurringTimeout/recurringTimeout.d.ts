import EventEmitter from '../../controllers/eventEmitter/eventEmitter';
type RecurringTimeoutStartOptions = {
    timeout?: number;
    /**
     * Whether to run the function immediately upon starting,
     * instead of waiting for the first timeout interval.
     */
    runImmediately?: boolean;
    /**
     * Whether to allow the starting of a new function execution
     * even if the previous one is still running. There will still
     * be only one interval scheduled at a time.
     *
     * @example
     * - Execution 1 starts
     * - Execution 2 starts while Execution 1 is still running
     * - Execution 1 completes - a new execution is not scheduled. Simply
     * the promise of Execution 1 is resolved.
     * - Execution 2 completes - a new execution is scheduled.
     */
    allowOverlap?: boolean;
};
export interface IRecurringTimeout {
    start: (options?: RecurringTimeoutStartOptions) => void;
    restart: (options?: RecurringTimeoutStartOptions) => void;
    stop: () => void;
    updateTimeout: (options: {
        timeout: number;
    }) => void;
    running: boolean;
    sessionId: number;
    fnExecutionsCount: number;
    startedRunningAt: number;
    currentTimeout: number;
    promise: Promise<void> | undefined;
    startScheduled: boolean;
}
export declare class RecurringTimeout implements IRecurringTimeout {
    #private;
    sessionId: number;
    fnExecutionsCount: number;
    running: boolean;
    startedRunningAt: number;
    currentTimeout: number;
    promise: Promise<void> | undefined;
    startScheduled: boolean;
    constructor(fn: () => Promise<void>, timeout: number, emitError?: EventEmitter['emitError'], id?: string);
    updateTimeout({ timeout }: {
        timeout: number;
    }): void;
    start(opts?: RecurringTimeoutStartOptions): void;
    stop(): void;
    restart(opts?: RecurringTimeoutStartOptions): void;
}
export {};
//# sourceMappingURL=recurringTimeout.d.ts.map