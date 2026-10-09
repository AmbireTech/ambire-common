import { getBytes } from 'ethers'

import EmittableError from '@/classes/EmittableError'
import EventEmitter from '@/controllers/eventEmitter/eventEmitter'
import { Account, IAccountsController } from '@/interfaces/account'
import { IAddressBookController } from '@/interfaces/addressBook'
import { IAppDataSyncController } from '@/interfaces/appDataSync'
import { IEventEmitterRegistryController, Statuses } from '@/interfaces/eventEmitter'
import { IFeatureFlagsController } from '@/interfaces/featureFlags'
import { IKeystoreController } from '@/interfaces/keystore'
import { INetworksController } from '@/interfaces/network'
import { ISwapAndBridgeController } from '@/interfaces/swapAndBridge'
import { IUiController } from '@/interfaces/ui'
import {
  APP_DATA_SYNC_FEATURE_FLAGS,
  APP_DATA_SYNC_PAYLOAD_VERSION,
  AppDataSyncExportOptions,
  AppDataSyncPayload,
  getAppDataSyncKeyAddrs,
  parseAppDataSyncPayload,
  serializeAppDataSyncPayload
} from '@/libs/appDataSync/appDataSync'

export const STATUS_WRAPPED_METHODS = {
  exportData: 'INITIAL',
  importData: 'INITIAL'
} as const

/**
 * Syncs the wallet's data (accounts and their keys, settings, networks and the Address
 * Book) between the Ambire extension and the mobile app through animated QR codes.
 * It only puts the payload together and spreads it back over the other controllers,
 * which merge their part of it themselves.
 */
export class AppDataSyncController extends EventEmitter implements IAppDataSyncController {
  #keystore: IKeystoreController

  #accounts: IAccountsController

  #networks: INetworksController

  #addressBook: IAddressBookController

  #featureFlags: IFeatureFlagsController

  #swapAndBridge: ISwapAndBridgeController

  #ui: IUiController

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  constructor({
    eventEmitterRegistry,
    keystore,
    accounts,
    networks,
    addressBook,
    featureFlags,
    swapAndBridge,
    ui
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    keystore: IKeystoreController
    accounts: IAccountsController
    networks: INetworksController
    addressBook: IAddressBookController
    featureFlags: IFeatureFlagsController
    swapAndBridge: ISwapAndBridgeController
    ui: IUiController
  }) {
    super(eventEmitterRegistry)

    this.#keystore = keystore
    this.#accounts = accounts
    this.#networks = networks
    this.#addressBook = addressBook
    this.#featureFlags = featureFlags
    this.#swapAndBridge = swapAndBridge
    this.#ui = ui
  }

  /**
   * Runs a sync step and replies to the UI request that triggered it, so the
   * UI can await the result instead of watching a transient status.
   */
  async #withSyncResponse(
    callName: keyof typeof STATUS_WRAPPED_METHODS,
    requestId: string | undefined,
    fn: () => Promise<any>
  ) {
    await this.withStatus(callName, async () => {
      try {
        const res = await fn()

        if (requestId) this.#ui.message.sendUiMessage({ requestId, ok: true, res })
      } catch (error: any) {
        // Rethrown, so that `withStatus` emits (and reports) the error as usual
        if (requestId)
          this.#ui.message.sendUiMessage({
            requestId,
            ok: false,
            error: error?.message || `${callName} failed`
          })

        throw error
      }
    })
  }

  /**
   * Prepares the selected accounts and the keys controlling them for the other Ambire
   * product and returns the payload, which the UI displays as animated QR codes.
   * Everything sensitive leaves this device encrypted, see `keystore.exportForSync`.
   *
   * `includeSeeds` lets the user leave the recovery phrases of the selected accounts
   * behind, in which case only the accounts and their keys are sent over. The settings,
   * the networks and the Address Book travel only if the user chose them, and they can
   * also be synced without any accounts.
   */
  async exportData(
    addrs: Account['addr'][],
    { includeSeeds, appSettings, includeNetworks, includeContacts }: AppDataSyncExportOptions,
    requestId?: string
  ) {
    await this.#withSyncResponse('exportData', requestId, async () => {
      const accounts = this.#accounts.accounts.filter((account) => addrs.includes(account.addr))

      if (!accounts.length && !appSettings && !includeNetworks && !includeContacts)
        throw new EmittableError({
          level: 'expected',
          message: 'Select what you want to sync.',
          error: new Error('appDataSync: nothing to sync')
        })

      const { secret, keys, seeds } = await this.#keystore.exportForSync(
        getAppDataSyncKeyAddrs(accounts),
        includeSeeds
      )

      return serializeAppDataSyncPayload({
        v: APP_DATA_SYNC_PAYLOAD_VERSION,
        secret,
        accounts,
        keys,
        seeds,
        ...(appSettings && {
          settings: {
            featureFlags: Object.fromEntries(
              APP_DATA_SYNC_FEATURE_FLAGS.map((flag) => [
                flag,
                this.#featureFlags.isFeatureEnabled(flag)
              ])
            ),
            disabledSwapProviderIds: this.#swapAndBridge.getDisabledSwapProviderIds(),
            app: appSettings
          }
        }),
        ...(includeNetworks && { networks: this.#networks.allNetworks }),
        // The wallet's own accounts are contacts too, but each device derives them itself
        ...(includeContacts && {
          contacts: this.#addressBook.contacts.filter((contact) => !contact.isWalletAccount)
        })
      })
    })
  }

  /**
   * Takes over the accounts and keys scanned from the other Ambire product's QR codes,
   * along with the settings, networks and contacts if the user chose to sync them. Those
   * are merged: what comes from the other product overrides what is here, the rest stays.
   * `payload` is the hex encoded data assembled from the scanned codes and `password`
   * is the device password of the product that exported them, needed only when the
   * payload holds private keys or recovery phrases.
   */
  async importData(
    { payload, password }: { payload: string; password?: string },
    requestId?: string
  ) {
    await this.#withSyncResponse('importData', requestId, async () => {
      let parsedPayload: AppDataSyncPayload
      try {
        parsedPayload = parseAppDataSyncPayload(getBytes(payload))
      } catch (error: any) {
        throw new EmittableError({
          level: 'expected',
          message:
            'The scanned QR codes do not contain Ambire accounts, or not all of them were scanned. Please try again.',
          error: error instanceof Error ? error : new Error('appDataSync: invalid sync payload')
        })
      }

      // The accounts are added only if the keys made it in, so that the user doesn't
      // end up with accounts they cannot sign with
      await this.#keystore.importFromSync(parsedPayload, password)

      const { networks, contacts, settings } = parsedPayload
      // Before the accounts, so their first update already runs on the synced networks
      if (networks) await this.#networks.mergeNetworks(networks)

      if (parsedPayload.accounts.length) await this.#accounts.addAccounts(parsedPayload.accounts)

      // After the accounts, so the ones that are contacts here already are skipped
      if (contacts) await this.#addressBook.mergeContacts(contacts)

      // The app settings (like the theme) are kept by the app, so it applies them itself
      if (settings) {
        const featureFlags = APP_DATA_SYNC_FEATURE_FLAGS.reduce(
          (flags, flag) =>
            typeof settings.featureFlags[flag] === 'boolean'
              ? { ...flags, [flag]: settings.featureFlags[flag] }
              : flags,
          {}
        )
        await this.#featureFlags.setFeatureFlags(featureFlags)
        await this.#swapAndBridge.setDisabledSwapProviderIds(settings.disabledSwapProviderIds)
      }
    })
  }
}
