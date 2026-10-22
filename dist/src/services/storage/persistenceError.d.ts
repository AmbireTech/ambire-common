interface PersistenceError {
    message: string;
    error: Error;
}
/** Reported instead of thrown — persistence coordinators degrade rather than fail a caller. */
export type ReportPersistenceError = (e: PersistenceError) => void;
/**
 * Pairs the user-facing message with a real Error, synthesising one from `context` when
 * something non-Error was thrown, so Sentry always gets a stack.
 */
export declare function toPersistenceError(message: string, error: unknown, context: string): PersistenceError;
export {};
//# sourceMappingURL=persistenceError.d.ts.map