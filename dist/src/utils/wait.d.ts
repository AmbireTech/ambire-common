declare function wait(ms: number): Promise<unknown>;
export declare function waitWithAbort(ms: number): {
    promise: Promise<void>;
    abort: () => void;
};
export default wait;
//# sourceMappingURL=wait.d.ts.map