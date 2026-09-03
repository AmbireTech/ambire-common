import EmittableError from '@/classes/EmittableError'
import EventEmitter from '@/controllers/eventEmitter/eventEmitter'
import { IEventEmitterRegistryController, Statuses } from '@/interfaces/eventEmitter'
import { Fetch } from '@/interfaces/fetch'
import { IInviteController } from '@/interfaces/invite'
import { IStorageController } from '@/interfaces/storage'
import { BindedRelayerCall, relayerCall } from '@/libs/relayerCall/relayerCall'

export enum INVITE_STATUS {
  UNVERIFIED = 'UNVERIFIED',
  VERIFIED = 'VERIFIED'
}

export const STATUS_WRAPPED_METHODS = {
  verify: 'INITIAL'
} as const

type InviteState = {
  status: INVITE_STATUS
  verifiedAt: null | number // timestamp
  verifiedCode: null | string
  becameOGAt: null | number // timestamp
}

const DEFAULT_STATE = {
  status: INVITE_STATUS.UNVERIFIED,
  verifiedAt: null,
  verifiedCode: null,
  becameOGAt: null
}

/**
 * Manages the invite gate and the OG status.
 *
 * The gate was mandatory for the extension between v4.20.0 and v5.1.0, and is mandatory for the
 * mobile app as of the mobile v2 release. Both use the same relayer endpoint and the same `invite`
 * storage entry, so verifying is one and the same mechanism - the only difference is that the
 * extension no longer enforces it.
 *
 * The controller is platform-agnostic on purpose - it only stores and verifies. Whether the gate
 * is enforced at all is decided by the router of the app using it.
 */
export class InviteController extends EventEmitter implements IInviteController {
  #storage: IStorageController

  #callRelayer: BindedRelayerCall

  #state: InviteState = DEFAULT_STATE

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  /** Whether the invite gate has been passed. Only the mobile app enforces it. */
  inviteStatus: InviteState['status'] = INVITE_STATUS.UNVERIFIED

  /** The invite code the gate was passed with. The extension builds its analytics instance id from it. */
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

    this.inviteStatus = this.#state.status
    this.verifiedCode = this.#state.verifiedCode
    this.isOG = !!this.#state.becameOGAt
    this.emitUpdate()
  }

  async #persistVerified(code: string) {
    this.#state = {
      ...this.#state,
      status: INVITE_STATUS.VERIFIED,
      verifiedAt: Date.now(),
      verifiedCode: code
    }

    this.inviteStatus = this.#state.status
    this.verifiedCode = this.#state.verifiedCode
    this.emitUpdate()

    await this.#storage.set('invite', this.#state)
  }

  /** Verifies an invite code against the relayer and, if valid, passes the gate for good. */
  async verify(code: string) {
    await this.#initialLoadPromise

    await this.withStatus('verify', async () => {
      try {
        await this.#callRelayer(`/promotions/extension-key/${code}`, 'GET')
      } catch (error: any) {
        throw new EmittableError({
          message: 'Oops, that code didn’t work. Check for a typo and try again.',
          level: 'major',
          error
        })
      }

      await this.#persistVerified(code)
    })
  }

  /**
   * Passes the gate without asking the relayer, for everyone who was already using the app before
   * the gate got introduced - an app update must never lock them out. The caller passes the code
   * to record for them, so that their verified code is never blank.
   */
  async grantAccess(code: string) {
    await this.#initialLoadPromise

    if (this.inviteStatus === INVITE_STATUS.VERIFIED) return

    await this.#persistVerified(code)
  }

  async becomeOG() {
    await this.#initialLoadPromise

    this.#state = { ...this.#state, becameOGAt: Date.now() }
    this.isOG = true
    this.emitUpdate()

    await this.#storage.set('invite', this.#state)
  }

  async revokeOG() {
    await this.#initialLoadPromise

    this.#state = { ...this.#state, becameOGAt: null }
    this.isOG = false
    this.emitUpdate()

    await this.#storage.set('invite', this.#state)
  }
}
