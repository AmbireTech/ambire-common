export declare const SEED_NAMESPACES: string[];
export type DebugLogOptions = {
    /**
     * Can be used to correlate related log lines across flows and controllers. E.g.,
     * every log inside of a portfolio update has the same traceId, so one can filter for that ID in the console.
     * Although nice, this is a lot more cumbersome for complex flows so we don't require it and it's opt-in per log line rather than per logger.
     */
    traceId?: string;
    level?: 'log' | 'warn';
};
export declare const debugLoggerRegistry: {
    isEnabled: (namespace: string) => boolean;
    registerNamespace: (namespace: string) => void;
    catalog: () => string[];
    setEnabled: (namespace: string, value: boolean) => void;
    hydrate: (state: Record<string, boolean>) => void;
    snapshot: () => Record<string, boolean>;
    read: (namespace: string) => string[];
    clear: (namespace?: string) => boolean | void;
    subscribe: (cb: () => void) => () => void;
};
export declare function debugLog(namespace: string, flow: string, message: string, payload?: unknown | (() => unknown), options?: DebugLogOptions): void;
/**
 * Used by libraries to create a logger function pre-bound to their namespace, so they
 * don't have to pass the namespace on every call. Example: Used by the portfolio lib to
 * log under the PortfolioController namespace
 */
export declare function createScopedDebugLogger<Flow extends string = string>(namespace: string): (flow: Flow, message: string, payload?: unknown | (() => unknown), options?: DebugLogOptions) => void;
//# sourceMappingURL=debugLogger.d.ts.map