export type ErrorRef = {
    message: string;
    level: 'fatal' | 'major' | 'minor' | 'silent';
    error: Error;
};
export type Statuses<T extends string> = {
    [key in T]: 'INITIAL' | 'LOADING' | 'SUCCESS' | 'ERROR';
};
export default class EventEmitter {
    #private;
    statuses: Statuses<string>;
    get onUpdateIds(): (string | null)[];
    get onErrorIds(): (string | null)[];
    get emittedErrors(): ErrorRef[];
    /**
     * Using this function to emit an update bypasses both background and React batching,
     * ensuring that the state update is immediately applied at the application level (React/Extension).
     *
     * This is particularly handy when multiple status flags are being updated rapidly.
     * Without the `forceEmitUpdate` option, the application will only render the very first and last status updates,
     * batching the ones in between.
     */
    forceEmitUpdate(): Promise<void>;
    protected emitUpdate(): void;
    protected emitError(error: ErrorRef): void;
    protected withStatus(callName: string, fn: Function, allowConcurrentActions?: boolean, errorLevel?: ErrorRef['level']): Promise<void>;
    onUpdate(cb: (forceUpdate?: boolean) => void, id?: string): () => void;
    onError(cb: (error: ErrorRef) => void, id?: string): () => void;
    toJSON(): this & {
        emittedErrors: ErrorRef[];
    };
}
//# sourceMappingURL=eventEmitter.d.ts.map