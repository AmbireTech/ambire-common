"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AMBIRE_IDB_SCHEMA = void 0;
// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────
exports.AMBIRE_IDB_SCHEMA = {
    dbName: 'ambire',
    dbVersion: 1,
    stores: [
        {
            storeName: 'accountsOps',
            keyPath: ['accountAddr', 'chainId', 'id'],
            indexes: [
                {
                    name: 'by-account-chain-timestamp',
                    keyPath: ['accountAddr', 'chainId', 'timestamp']
                },
                {
                    name: 'by-account-chain-status',
                    keyPath: ['accountAddr', 'chainId', 'status']
                },
                {
                    // Turns the duplicate check into a point lookup instead of a walk of the whole
                    // group. multiEntry cannot be compound, so it is keyed on txnId alone — the
                    // account is read back from the primary key, which already contains it.
                    name: 'by-txn-id',
                    keyPath: 'txnIds',
                    multiEntry: true
                }
            ]
        }
    ],
    // Human-readable changelog of the schema. Not read at runtime — the executable
    // counterparts are `stores` above (structure) and `migrationHandlers` in
    // idbDatabase.ts keyed by toVersion (row transformations).
    migrations: [
        {
            fromVersion: 0,
            toVersion: 1,
            description: 'Initial schema: accountsOps store with timestamp, status and txnId indexes'
        }
    ]
};
//# sourceMappingURL=idbSchema.js.map