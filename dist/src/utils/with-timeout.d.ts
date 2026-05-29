export declare const DEFAULT_TIMEOUT_MESSAGE = "timed out, race timer resolved first";
export declare const DEFAULT_TIMEOUT_MS = 5000;
/**
 * Run an async task with a soft timeout using Promise.race. Notes:
 * - By default, this utility does not cancel the underlying task. If the timeout wins the race,
 *   the returned promise rejects, but the task may continue running in the background.
 * - To also signal cancellation to the underlying operation, pass `{ useAbort: true }`.
 *   In that case, a new `AbortController` is created, its `signal` is provided to the task,
 *   and on timeout the controller is aborted.
 * - Callers may ignore the signal if they don't support cancellation; behavior falls back to soft timeout.
 */
export declare function withTimeout<T>(task: (args?: {
    signal?: AbortSignal | null;
}) => Promise<T>, options?: {
    timeoutMs?: number;
    message?: string;
    useAbort?: boolean;
}): Promise<T>;
//# sourceMappingURL=with-timeout.d.ts.map