import { IStorageController } from '../../interfaces/storage'
import { AmbireIdbDatabase } from './idbDatabase'
import { ReportPersistenceError, toPersistenceError } from './persistenceError'
import {
  DEFAULT_PHISHING_META,
  DEFAULT_PHISHING_SNAPSHOT,
  IPhishingBackend,
  PhishingDelta,
  PhishingIdbStorage,
  PhishingKeyValueStorage,
  PhishingMeta,
  PhishingSnapshot
} from './phishingIdb'

interface PhishingPersistenceParams {
  storage: IStorageController
  /** The connection opened at startup, or undefined where IDB does not exist (mobile). */
  idb?: AmbireIdbDatabase
  /** Reported instead of thrown — a read failure must never leave an empty blocklist. */
  onError: ReportPersistenceError
}

/**
 * Owns where the phishing lists live, so PhishingController does not have to.
 *
 * Reads degrade rather than throw: an unguarded failure would reject the controller's load,
 * skip the update interval and leave NO blocklist for the whole session.
 */
export class PhishingPersistence {
  #adapter: IPhishingBackend

  #storage: IStorageController

  #onError: ReportPersistenceError

  constructor({ storage, idb, onError }: PhishingPersistenceParams) {
    this.#storage = storage
    this.#onError = onError
    this.#adapter = idb ? new PhishingIdbStorage(idb) : new PhishingKeyValueStorage(storage)
  }

  /** Migrate if needed, then return the checkpoint. Entries are not read. */
  async init(): Promise<PhishingMeta> {
    await this.#migrate()

    try {
      return await this.#adapter.loadMeta()
    } catch (error) {
      this.#report('Your phishing protection list could not be loaded.', error, 'read the version')

      // Zero means "fetch everything", so protection is restored on the next update rather
      // than resuming from a checkpoint whose entries may not have loaded.
      return { ...DEFAULT_PHISHING_META }
    }
  }

  /**
   * @returns null when the lookup itself failed — NOT false. A blocklist that cannot be read
   *          says nothing about the entry, and reporting "absent" would mark a scam domain
   *          VERIFIED. Callers map null to the same "unknown" they use before the list loads.
   */
  async hasDomain(domain: string): Promise<boolean | null> {
    try {
      return await this.#adapter.hasDomain(domain)
    } catch (error) {
      this.#report('A website could not be checked against the scam list.', error, 'check a domain')

      return null
    }
  }

  /** Null on failure, for the same reason as hasDomain(). */
  async hasAddress(address: string): Promise<boolean | null> {
    try {
      return await this.#adapter.hasAddress(address)
    } catch (error) {
      this.#report(
        'An address could not be checked against the scam list.',
        error,
        'check an address'
      )

      return null
    }
  }

  /**
   * Both writes REJECT on failure, unlike the reads. The caller uses that to fall back to its
   * short retry interval — swallowing it would leave the checkpoint behind the fetched data.
   */
  replaceAll(snapshot: PhishingSnapshot): Promise<void> {
    return this.#adapter.replaceAll(snapshot)
  }

  applyDelta(delta: PhishingDelta, meta: PhishingMeta): Promise<void> {
    return this.#adapter.applyDelta(delta, meta)
  }

  /**
   * The legacy key is deliberately kept: it is small and refetchable, and loadAll() falls back
   * to it rather than to an empty blocklist.
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

  #readLegacy(): Promise<PhishingSnapshot> {
    return this.#storage.get('phishing', { ...DEFAULT_PHISHING_SNAPSHOT })
  }

  #report(message: string, error: unknown, what: string): void {
    this.#onError(toPersistenceError(message, error, `PhishingPersistence: failed to ${what}`))
  }
}
