import { Fetch } from '../../interfaces/fetch'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import EventEmitter from '../eventEmitter/eventEmitter'
import { StorageController } from '../storage/storage'

// eslint-disable-next-line @typescript-eslint/naming-convention
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
 */
export class InviteController extends EventEmitter {
  #storage: StorageController

  #callRelayer: Function

  #state: InviteState = DEFAULT_STATE

  inviteStatus: InviteState['status'] = INVITE_STATUS.UNVERIFIED

  verifiedCode: InviteState['verifiedCode'] = null

  /**
   * Whether the user has become an Ambire OG (Original Gangster), a status that
   * comes with specific privileges (e.g. early access to new or experimental features).
   */
  isOG: boolean = false

  #initialLoadPromise: Promise<void>

  constructor({
    relayerUrl,
    fetch,
    storage
  }: {
    relayerUrl: string
    fetch: Fetch
    storage: StorageController
  }) {
    super()

    this.#storage = storage
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    this.#initialLoadPromise = this.#load()
  }

  async #load() {
    const nextState = await this.#storage.get('invite', this.#state)
    this.#state = { ...DEFAULT_STATE, ...nextState }

    this.inviteStatus = this.#state.status
    this.verifiedCode = this.#state.verifiedCode
    this.isOG = !!this.#state.becameOGAt
    this.emitUpdate()
  }

  /**
   * Verifies an invite code and if verified successfully, persists the invite
   * status (and some meta information) in the storage.
   */
  async verify(code: string) {
    await this.#initialLoadPromise

    try {
      const res = await this.#callRelayer(`/promotions/extension-key/${code}`, 'GET')

      if (!res.success) throw new Error(res.message || "Couldn't verify the invite code")

      this.inviteStatus = INVITE_STATUS.VERIFIED
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
