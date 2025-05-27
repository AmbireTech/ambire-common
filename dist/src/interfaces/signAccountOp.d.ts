type Warning = {
    id: string;
    title: string;
    text?: string;
    promptBefore?: ('sign' | 'one-click-sign')[];
};
type SignAccountOpError = {
    title: string;
    code?: string;
    text?: string;
};
declare enum TraceCallDiscoveryStatus {
    NotStarted = "not-started",
    InProgress = "in-progress",
    SlowPendingResponse = "slow-pending-response",
    Done = "done",
    Failed = "failed"
}
export { TraceCallDiscoveryStatus };
export type { Warning, SignAccountOpError };
//# sourceMappingURL=signAccountOp.d.ts.map