import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { IInviteController } from '../../interfaces/invite'
import { IStorageController } from '../../interfaces/storage'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import EventEmitter from '../eventEmitter/eventEmitter'

export enum INVITE_STATUS {
  UNVERIFIED = 'UNVERIFIED',
  VERIFIED = 'VERIFIED'
}

type InviteState = {
  status: INVITE_STATUS
  verifiedAt: null | number // timestamp
  verifiedCode: null | string
  becameOGAt: null // timestamp
}

const DEFAULT_STATE = {
  status: INVITE_STATUS.UNVERIFIED,
  verifiedAt: null,
  verifiedCode: null,
  becameOGAt: null
}

/**
 * As of v5.1.0, invite code is no longer required for using the extension. In
 * v4.20.0, a mandatory invite verification flow is introduced as a first step
 * upon extension installation. The controller is still used to manage OG status
 * and other invite-related data.
 *
 * TODO: Bring back a mandatory invite gate, this time for the mobile app only
 * and temporarily. It must live in a scope of its own, so that the legacy flow
 * below stays untouched (deprecated, but still read from). Required changes:
 * 1. A new storage key (e.g. `inviteMobileAccess`) in `StorageProps`, holding
 *    `{ status, verifiedAt, verifiedCode }`. The legacy `invite` key must NOT be
 *    reused nor dropped - it still stores `becameOGAt` (the OG status) and
 *    `verifiedCode` (read by the extension for its analytics instance id).
 * 2. New public state (e.g. `mobileAccessStatus` and `verifiedMobileAccessCode`),
 *    reusing the `INVITE_STATUS` enum, hydrated in `#load()` from the new key.
 * 3. A new `verifyMobileAccess(code)` method, wrapped in `withStatus`, so that
 *    the UI gets the loading state and the duplicate-submit guard for free. The
 *    relayer endpoint is still TBD - `/promotions/extension-key/:code` is
 *    extension-scoped, so the mobile gate most likely needs its own one.
 * 4. Keep the controller platform-agnostic - no `isMobile` checks in here. The
 *    mobile router is the one that decides whether to enforce the gate.
 * 5. Existing mobile users must NOT see the gate, they get auto-access -
 *    otherwise an app update would lock them out. Only fresh installs get gated.
 *    Enforcing the gate only on fresh installs could be based on empty keystore,
 *    i.e. `!keystoreState.isReadyToStoreKeys`. And to not complicate additionally
 *    the controller here - this logic could live in the mobile router only.
 *    Users updating from the legacy v1 app must NOT see the gate either - their
 *    keystore is empty (v1 data lives in a separate storage), but we can bypass
 *    them by `hasLegacyAccounts()` from `@mobile/services/legacyMigration`, NOT by
 *    `shouldShowMigrationOnboarding()` - the latter flips to false once they pass
 *    the onboarding, which would then drop them straight into the invite gate.
 */
export class InviteController extends EventEmitter implements IInviteController {
  #storage: IStorageController

  #callRelayer: Function

  #state: InviteState = DEFAULT_STATE

  /** @deprecated The legacy (extension) invite gate. Not enforced anymore. */
  // inviteStatus: InviteState['status'] = INVITE_STATUS.UNVERIFIED // TODO: Delete.

  /**
   * @deprecated Belongs to the legacy (extension) invite gate. Still read by the
   * extension to build its analytics instance id, so it must be kept as is.
   */
  verifiedCode: InviteState['verifiedCode'] = null

  /**
   * Whether the user has become an Ambire OG (Original Gangster), a status that
   * comes with specific privileges (e.g. early access to new or experimental features).
   */
  isOG: boolean = false

  #initialLoadPromise?: Promise<void>

  constructor({
    eventEmitterRegistry,
    relayerUrl,
    fetch,
    storage
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    relayerUrl: string
    fetch: Fetch
    storage: IStorageController
  }) {
    super(eventEmitterRegistry)

    this.#storage = storage
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    this.#initialLoadPromise = this.#load().finally(() => {
      this.#initialLoadPromise = undefined
    })
  }

  async #load() {
    const nextState = await this.#storage.get('invite', this.#state)
    this.#state = { ...DEFAULT_STATE, ...nextState }

    // this.inviteStatus = this.#state.status // TODO: Delete.
    this.verifiedCode = this.#state.verifiedCode
    this.isOG = !!this.#state.becameOGAt
    this.emitUpdate()
  }

  /**
   * Verifies an invite code and if verified successfully, persists the invite
   * status (and some meta information) in the storage.
   *
   * @deprecated Belongs to the legacy (extension) invite gate - no UI calls it
   * anymore. The mobile gate gets its own method, see the class TODO above.
   * TODO: Maybe delete.
   */
  async verify(code: string) {
    await this.#initialLoadPromise

    try {
      const res = await this.#callRelayer(`/promotions/extension-key/${code}`, 'GET')

      if (!res.success) throw new Error(res.message || "Couldn't verify the invite code")

      // this.inviteStatus = INVITE_STATUS.VERIFIED // TODO: Delete
      this.verifiedCode = code
      this.emitUpdate()

      const verifiedAt = Date.now()
      await this.#storage.set('invite', {
        ...this.#state,
        status: INVITE_STATUS.VERIFIED,
        verifiedAt,
        verifiedCode: code
      })
    } catch (error: any) {
      this.emitError(error)
    }
  }

  async becomeOG() {
    await this.#initialLoadPromise

    const becameOGAt = Date.now()
    await this.#storage.set('invite', { ...this.#state, becameOGAt })

    this.isOG = true
    this.emitUpdate()
  }

  async revokeOG() {
    await this.#initialLoadPromise

    await this.#storage.set('invite', { ...this.#state, becameOGAt: null })

    this.isOG = false
    this.emitUpdate()
  }
}
