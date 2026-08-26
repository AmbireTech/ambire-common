import { IStorageController } from '../../interfaces/storage'
import { AmbireIdbDatabase } from './idbDatabase'
import { ReportPersistenceError, toPersistenceError } from './persistenceError'
import {
  DEFAULT_PHISHING_SNAPSHOT,
  IPhishingOpsBackend,
  PhishingIdbStorage,
  PhishingKeyValueStorage,
  PhishingSnapshot
} from './phishingIdb'

interface PhishingPersistenceParams {
  storage: IStorageController
  /** Undefined where IndexedDB does not exist (mobile), which selects the key-value backend. */
  idb?: AmbireIdbDatabase
  /** Reported instead of thrown — every method here degrades rather than failing a caller. */
  onError: ReportPersistenceError
}

/**
 * Owns where the phishing snapshot lives, so PhishingController does not have to.
 *
 * Adding a storage service means writing an IPhishingOpsBackend adapter and selecting it in
 * #pickAdapter — nothing in the controller changes.
 */
export class PhishingPersistence {
  #adapter: IPhishingOpsBackend

  #storage: IStorageController

  #onError: ReportPersistenceError

  constructor({ storage, idb, onError }: PhishingPersistenceParams) {
    this.#storage = storage
    this.#onError = onError
    this.#adapter = this.#pickAdapter(idb)
  }

  #pickAdapter(idb?: AmbireIdbDatabase): IPhishingOpsBackend {
    if (idb) return new PhishingIdbStorage(idb)

    return new PhishingKeyValueStorage(this.#storage)
  }

  /**
   * Migrate if needed, then return the snapshot to start the session with.
   *
   * Never rejects. The caller's load promise carries no catch, and a throw would skip starting
   * its update interval — leaving an empty blocklist all session.
   */
  async init(): Promise<PhishingSnapshot> {
    await this.#migrate()

    return this.#loadSnapshot()
  }

  /**
   * The one method here that DOES reject, deliberately: the caller catches to switch to the
   * failed-retry interval. Swallowing it would silently disable that retry.
   */
  async save(snapshot: PhishingSnapshot): Promise<void> {
    await this.#adapter.saveSnapshot(snapshot)
  }

  /**
   * The legacy key is deliberately kept: it is small and refetchable, and #loadSnapshot falls
   * back to it rather than to an empty blocklist.
   */
  async #migrate(): Promise<void> {
    try {
      await this.#adapter.ensureMigrated(
        () => this.#readLegacy(),
        // Retained on purpose, see above.
        async () => {}
      )
    } catch (error) {
      this.#report(
        'The phishing protection list could not be moved to its new location.',
        error,
        'migrate'
      )
    }
  }

  /**
   * Falls back to the legacy copy, then to empty. That copy is frozen at migration time, so it
   * can be stale — the caller's update interval refetches from whatever `version` it yields.
   */
  async #loadSnapshot(): Promise<PhishingSnapshot> {
    try {
      return await this.#adapter.loadSnapshot()
    } catch (error) {
      this.#report('Your phishing protection list could not be loaded.', error, 'read the snapshot')
    }

    try {
      return await this.#readLegacy()
    } catch {
      // Not re-reported — #migrate already emitted this.
      return { ...DEFAULT_PHISHING_SNAPSHOT }
    }
  }

  #readLegacy(): Promise<PhishingSnapshot> {
    return this.#storage.get('phishing', { ...DEFAULT_PHISHING_SNAPSHOT })
  }

  #report(message: string, error: unknown, what: string): void {
    this.#onError(toPersistenceError(message, error, `PhishingPersistence: failed to ${what}`))
  }
}
