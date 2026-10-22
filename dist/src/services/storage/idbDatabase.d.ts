/**
 * Global IDB initializer for the 'ambire' database.
 *
 * Call openAmbireIdb() once at startup and AWAIT it before constructing any controller —
 * that await is what guarantees every schema migration finished before a controller reads.
 * Mobile never calls it and passes undefined instead, so no platform check belongs here.
 *
 * Startup order, the schema/data migration distinction, and the rules for writing a
 * migration handler are documented in ./README.md. Read it before changing this file.
 */
import { IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import { AmbireIdbSchema, IdbStoreDef } from './idbSchema';
export type AmbireIdbDatabase = IDBPDatabase<AmbireIdbSchema>;
/** The versionchange transaction handed to migration handlers. */
export type AmbireIdbUpgradeTransaction = IDBPTransaction<AmbireIdbSchema, ArrayLike<StoreNames<AmbireIdbSchema>>, 'versionchange'>;
/**
 * Create every store and index in the manifest that does not exist yet. Idempotent, runs on
 * every upgrade, and only ever ADDS — see "Structure is declarative" in ./README.md.
 */
export declare function reconcileSchema(db: AmbireIdbDatabase, tx: AmbireIdbUpgradeTransaction, stores?: IdbStoreDef[]): void;
/**
 * Data-migration handlers, keyed by the version they migrate TO. Upgrading v(n) → v(m) runs
 * n+1..m in order inside the single onupgradeneeded transaction. Structure is NOT created
 * here — reconcileSchema() runs first.
 *
 * ⚠️ Handlers are SYNCHRONOUS. Chain off the read, never await it:
 *       store.getAll().then((rows) => rows.forEach((r) => store.put(migrate(r))))
 * Awaiting a non-IDB promise lets the versionchange transaction commit and the writes vanish
 * with no error — no unit test catches it, so do not tidy this into an `await`.
 *
 * The full rules for adding one are in ./README.md under "Writing a migration handler".
 */
export type MigrationHandler = (db: AmbireIdbDatabase, tx: AmbireIdbUpgradeTransaction) => void;
export declare const migrationHandlers: Record<number, MigrationHandler>;
/**
 * Reconcile structure, then run every data-migration handler in (oldVersion,
 * targetVersion] in ascending order. Returns the versions whose handlers ran,
 * which lets tests assert the sequence without duplicating the loop.
 *
 * Exported so that openAmbireIdb() and the tests exercise the same code path.
 *
 * @param handlers - Overridable only for tests; production always uses the
 *        module-level registry.
 */
export declare function applyMigrations(db: AmbireIdbDatabase, tx: AmbireIdbUpgradeTransaction, oldVersion: number, targetVersion: number, handlers?: Record<number, MigrationHandler>): number[];
export declare function openAmbireIdb(): Promise<AmbireIdbDatabase>;
/**
 * True when the error means our connection handle is dead while the database
 * itself is fine — the connection was closed by blocking(), terminated by the
 * browser, or otherwise went away underneath us.
 *
 * IndexedDB throws InvalidStateError from transaction() as soon as a connection
 * has its close-pending flag set, so this is the signal that a caller should
 * reopen and retry rather than give up.
 */
export declare function isClosedConnectionError(error: unknown): boolean;
/**
 * Drop the cached connection so the next openAmbireIdb() opens a fresh one.
 *
 * blocking() and terminated() already do this when they fire, but a connection can
 * also die without either event. In that case the cache still resolves to the dead
 * handle, so a caller recovering from isClosedConnectionError must invalidate first
 * — otherwise it reconnects to the same dead connection and fails again.
 */
export declare function invalidateAmbireIdbConnection(): void;
/**
 * Reset the singleton — for use in tests only.
 * Call before replacing global.indexedDB with a fresh IDBFactory.
 */
export declare function resetAmbireIdbForTesting(): void;
//# sourceMappingURL=idbDatabase.d.ts.map