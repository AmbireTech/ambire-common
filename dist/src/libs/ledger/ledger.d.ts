/**
 * Used to "translate" error codes (inside the messages) returned by the Ledger
 * device into a human-readable messages. Although alongside the raw error codes
 * there is a message incoming from Ledger too, it's not self-explanatory and
 * can be difficult for the end users to understand.
 */
export declare const normalizeLedgerMessage: (error?: string) => string;
//# sourceMappingURL=ledger.d.ts.map