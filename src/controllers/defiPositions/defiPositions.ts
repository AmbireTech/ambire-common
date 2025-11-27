import {
  IRecurringTimeout,
  RecurringTimeout
} from '../../classes/recurringTimeout/recurringTimeout'
import { ACTIVE_EXTENSION_DEFI_POSITIONS_UPDATE_INTERVAL } from '../../consts/intervals'
import { Account, AccountId, IAccountsController } from '../../interfaces/account'
import { IDefiPositionsController } from '../../interfaces/defiPositions'
import { Fetch } from '../../interfaces/fetch'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController, Network } from '../../interfaces/network'
import { IProvidersController, RPCProvider } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import { IUiController } from '../../interfaces/ui'
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import { getAssetValue, getProviderId } from '../../libs/defiPositions/helpers'
import {
  getAAVEPositions,
  getDebankEnhancedUniV3Positions
} from '../../libs/defiPositions/providers'
import getAccountNetworksWithPositions from '../../libs/defiPositions/providers/helpers/networksWithPositions'
import {
  AccountState,
  DeFiPositionsError,
  DeFiPositionsState,
  NetworksWithPositionsByAccounts,
  PositionsByProvider,
  ProviderError
} from '../../libs/defiPositions/types'
import { fetchWithTimeout } from '../../utils/fetch'
/* eslint-disable no-restricted-syntax */
import shortenAddress from '../../utils/shortenAddress'
import EventEmitter from '../eventEmitter/eventEmitter'

const ONE_MINUTE = 60000
export class DefiPositionsController extends EventEmitter implements IDefiPositionsController {
  #selectedAccount: ISelectedAccountController

  #keystore: IKeystoreController

  #accounts: IAccountsController

  #networks: INetworksController

  #providers: IProvidersController

  #ui: IUiController

  #fetch: Fetch

  #storage: IStorageController

  #state: DeFiPositionsState = {}

  #networksWithPositionsByAccounts: NetworksWithPositionsByAccounts = {}

  sessionIds: string[] = []

  #positionsContinuousUpdateInterval: IRecurringTimeout

  #updatePositionsPromise: Promise<void> | undefined

  #initialLoadPromise: Promise<void> | undefined

  get positionsContinuousUpdateInterval() {
    return this.#positionsContinuousUpdateInterval
  }

  constructor({
    fetch,
    storage,
    selectedAccount,
    keystore,
    accounts,
    networks,
    providers,
    ui
  }: {
    fetch: Fetch
    storage: IStorageController
    selectedAccount: ISelectedAccountController
    keystore: IKeystoreController
    accounts: IAccountsController
    networks: INetworksController
    providers: IProvidersController
    ui: IUiController
  }) {
    super()

    this.#fetch = fetch
    this.#storage = storage
    this.#selectedAccount = selectedAccount
    this.#keystore = keystore
    this.#accounts = accounts
    this.#networks = networks
    this.#providers = providers
    this.#ui = ui

    this.#initialLoadPromise = this.#load().finally(() => {
      this.#initialLoadPromise = undefined
    })

    this.#positionsContinuousUpdateInterval = new RecurringTimeout(
      async () => this.positionsContinuousUpdate(),
      ACTIVE_EXTENSION_DEFI_POSITIONS_UPDATE_INTERVAL,
      this.emitError.bind(this)
    )

    this.#ui.uiEvent.on('addView', () => {
      this.#positionsContinuousUpdateInterval.start()
    })

    this.#ui.uiEvent.on('removeView', () => {
      if (!this.#ui.views.length) this.#positionsContinuousUpdateInterval.stop()
    })
  }

  async #load() {
    try {
      this.#networksWithPositionsByAccounts = await this.#storage.get(
        'networksWithPositionsByAccounts',
        {}
      )

      this.emitUpdate()
    } catch (e: any) {
      this.emitError({
        message: 'Failed to load DeFi positions data from storage.',
        error: e,
        level: 'silent'
      })
    }
  }

  #getShouldSkipUpdate(
    accountAddr: string,
    _maxDataAgeMs = ONE_MINUTE,
    forceUpdate: boolean = false
  ) {
    const hasKeys = this.#keystore.keys.some(({ addr }) =>
      this.#selectedAccount.account!.associatedKeys.includes(addr)
    )
    let maxDataAgeMs = _maxDataAgeMs

    // force update the positions if forceUpdate is passed,
    // the account has keys and a session with the DeFi tab is opened
    const shouldForceUpdatePositions = forceUpdate && this.sessionIds.length && hasKeys
    if (shouldForceUpdatePositions) maxDataAgeMs = 30000 // half a min

    let latestUpdatedAt: number | undefined

    const accountState = Object.values(this.#state[accountAddr])

    if (accountState.some((n) => !n.updatedAt)) return false

    // eslint-disable-next-line no-restricted-syntax
    for (const network of accountState) {
      if (typeof network.updatedAt === 'number') {
        if (latestUpdatedAt === undefined || network.updatedAt > latestUpdatedAt) {
          latestUpdatedAt = network.updatedAt
        }
      }
    }

    if (!latestUpdatedAt) return false

    if (!forceUpdate && accountState.some((n) => n.providerErrors?.length || n.error)) {
      maxDataAgeMs = ONE_MINUTE
    }

    const isWithinMinUpdateInterval = Date.now() - latestUpdatedAt < maxDataAgeMs

    return isWithinMinUpdateInterval || accountState.some((n) => n.isLoading)
  }

  async #updateNetworksWithPositions(accountId: AccountId, accountState: AccountState) {
    this.#networksWithPositionsByAccounts[accountId] = getAccountNetworksWithPositions(
      accountId,
      accountState,
      this.#networksWithPositionsByAccounts,
      this.#providers.providers
    )

    await this.#storage.set(
      'networksWithPositionsByAccounts',
      this.#networksWithPositionsByAccounts
    )
  }

  async updatePositions(opts?: {
    chainIds?: bigint[]
    maxDataAgeMs?: number
    forceUpdate?: boolean
    forceDebankCall?: boolean
  }) {
    // If a previous update is still in progress, exit early to avoid
    // running multiple overlapping executions of the func. This ensures that only
    // one update runs at a time, preventing race conditions and inconsistent state/storage writes
    if (this.#updatePositionsPromise) return

    this.#updatePositionsPromise = this.#updatePositions(opts).finally(() => {
      this.#updatePositionsPromise = undefined
    })

    await this.#updatePositionsPromise
  }

  /**
   * Fetches the defi positions of certain protocols using RPC calls and custom logic.
   * Cena is used for most of the positions, but some protocols require additional data
   * that is not available in Cena. This function fetches those positions on ENABLED
   * networks only.
   *
   * Returns the old positions if the call fails. Some positions, like that of Uniswap V3,
   * are merged with the data from Cena/Debank.
   */
  async #getCustomProviderPositions(
    addr: string,
    provider: RPCProvider,
    network: Network,
    previousPositions: PositionsByProvider[],
    debankNetworkPositionsByProvider: PositionsByProvider[],
    isDebankCallSuccessful: boolean
  ): Promise<{
    positionsByProvider: PositionsByProvider[]
    providerErrors: ProviderError[]
    error?: DeFiPositionsError | null
  }> {
    if (network.disabled)
      return {
        positionsByProvider: [],
        providerErrors: []
      }

    try {
      const providerErrors: ProviderError[] = []
      let error: any

      let newPositions = (
        await Promise.all([
          getAAVEPositions(addr, provider, network).catch((e: any) => {
            this.emitError({
              message: `Failed to fetch AAVE v3 positions for ${addr} on ${network.name}.`,
              error: e,
              level: 'silent'
            })

            providerErrors.push({
              providerName: 'AAVE v3',
              error: e?.message || 'Unknown error'
            })

            return null
          }),
          // Uniswap is a bit of an odd case. We return the positions merged with Debank data
          getDebankEnhancedUniV3Positions(
            addr,
            provider,
            network,
            previousPositions,
            debankNetworkPositionsByProvider,
            isDebankCallSuccessful
          ).catch((e: any) => {
            this.emitError({
              message: `Failed to fetch Uniswap v3 positions for ${addr} on ${network.name}.`,
              error: e,
              level: 'silent'
            })

            providerErrors.push({
              providerName: 'Uniswap V3',
              error: e?.message || 'Unknown error'
            })

            return null
          })
        ])
      ).filter(Boolean) as PositionsByProvider[]

      if (newPositions.length) {
        try {
          newPositions =
            (await this.updatePositionsByProviderAssetPrices(newPositions, network.chainId)) ||
            newPositions
        } catch (e) {
          console.error(`#setAssetPrices error for ${addr} on ${network.name}:`, e)
          error = DeFiPositionsError.AssetPriceError
        }
      }

      // Get the previous custom positions that were not updated in this call
      // This is done so the user doesn't lose their custom positions when the
      // new update fails
      const filteredPrevious = previousPositions.filter(
        (prev) =>
          prev.source === 'custom' &&
          !newPositions.some(
            (n) => getProviderId(n.providerName) === getProviderId(prev.providerName)
          )
      )

      return {
        positionsByProvider: [...filteredPrevious, ...newPositions],
        providerErrors,
        error
      }
    } catch (e: any) {
      this.emitError({
        message: `Failed to fetch custom DeFi positions on ${network.name} for ${addr}`,
        error: e,
        level: 'silent'
      })
      return {
        positionsByProvider: previousPositions.filter((p) => p.source === 'custom'),
        providerErrors: [],
        error: DeFiPositionsError.CriticalError
      }
    }
  }

  /**
   * Merges Debank positions with custom fetched positions, ensuring uniqueness by provider.
   */
  static getUniqueMergedPositions(
    debankNetworkPositionsByProvider: PositionsByProvider[],
    customPositions: PositionsByProvider[]
  ): PositionsByProvider[] {
    const debankPositionMap = new Map(
      debankNetworkPositionsByProvider.map((p) => [getProviderId(p.providerName), p])
    )

    customPositions.forEach((custom) => {
      const key = getProviderId(custom.providerName)

      debankPositionMap.set(key, custom)
    })

    return Array.from(debankPositionMap.values())
  }

  /**
   * Updates an account's positions for a single network.
   */
  async #updateSingleNetwork(
    network: Network,
    selectedAccount: Account,
    debankPositionsByProvider: PositionsByProvider[] | null
  ) {
    const chain = network.chainId.toString()
    const debankNetworkPositionsByProvider =
      debankPositionsByProvider?.filter((p) => String(p.chainId) === String(network.chainId)) || []
    const previousNetworkPositionsByProvider =
      this.#state[selectedAccount.addr][chain].positionsByProvider
    const nonceId = this.#getNonceId(selectedAccount, network.chainId)
    const isDebankCallSuccessful = !!debankPositionsByProvider
    const state = this.#state[selectedAccount.addr][network.chainId.toString()]
    const {
      positionsByProvider: customPositionsByProvider,
      providerErrors: customProvidersErrors,
      error: customPositionsError
    } = await this.#getCustomProviderPositions(
      selectedAccount.addr,
      this.#providers.providers[chain],
      network,
      previousNetworkPositionsByProvider,
      debankNetworkPositionsByProvider,
      isDebankCallSuccessful
    )

    const uniqueAndMerged = DefiPositionsController.getUniqueMergedPositions(
      isDebankCallSuccessful
        ? debankNetworkPositionsByProvider
        : previousNetworkPositionsByProvider.filter((p) => p.source === 'debank'),
      customPositionsByProvider
    )

    this.#state[selectedAccount.addr][network.chainId.toString()] = {
      ...this.#state[selectedAccount.addr][network.chainId.toString()],
      nonceId,
      isLoading: false,
      error: !isDebankCallSuccessful ? DeFiPositionsError.CriticalError : customPositionsError,
      updatedAt: isDebankCallSuccessful && !customPositionsError ? Date.now() : state.updatedAt,
      providerErrors: customProvidersErrors,
      positionsByProvider: uniqueAndMerged || state.positionsByProvider
    }
  }

  /**
   * Makes the actual call to Debank to fetch DeFi positions.
   *
   * Note: It's private so we can mock it in tests.
   */
  private async callDebank(accountAddr: string, forceUpdate?: boolean) {
    const defiUrl = `https://cena.ambire.com/api/v3/defi/${accountAddr}`
    const hasKeys = this.#keystore.keys.some(({ addr }) =>
      this.#selectedAccount.account!.associatedKeys.includes(addr)
    )
    const shouldForceUpdatePositions = forceUpdate && this.sessionIds.length && hasKeys
    const hasFetchedBefore = Object.values(this.#state[accountAddr]).some((n) => n.updatedAt)

    const resp = await fetchWithTimeout(
      this.#fetch,
      shouldForceUpdatePositions ? `${defiUrl}?update=true` : defiUrl,
      {},
      hasFetchedBefore ? 5000 : 10000
    )

    const body = await resp.json()
    if (resp.status !== 200 || body?.message || body?.error) throw body

    return (body.data as Omit<PositionsByProvider, 'source'>[]) || []
  }

  /**
   * Fetches and formats the DeFi positions from Debank for a given account.
   *
   * Note: It's private so we can mock it in tests.
   */
  private async getDebankPositionsForAccount(accountAddr: string, forceUpdate?: boolean) {
    const result = await this.callDebank(accountAddr, forceUpdate)

    return result.map((p) => ({
      ...p,
      source: 'debank' as const,
      chainId: BigInt(p.chainId),
      positions: p.positions.map((pos) => {
        try {
          if (pos.additionalData.name === 'Deposit') {
            // eslint-disable-next-line no-param-reassign
            pos.additionalData.name = 'Deposit pool'
            // eslint-disable-next-line no-param-reassign
            pos.additionalData.positionIndex = shortenAddress(pos.additionalData.pool.id, 11)
          }

          return {
            ...pos,
            assets: pos.assets.map((asset) => ({
              ...asset,
              amount: BigInt(asset.amount)
            }))
          }
        } catch (error) {
          console.error('DeFi error: ', error)
          return pos
        }
      })
    }))
  }

  #initState(addr: string, networksToUpdate: Network[]) {
    if (!this.#state[addr]) {
      this.#state[addr] = {}
    }
    networksToUpdate.forEach((n) => {
      const chainId = n.chainId.toString()
      if (!this.#state[addr][chainId]) {
        this.#state[addr][chainId] = {
          isLoading: false,
          positionsByProvider: [],
          providerErrors: []
        }
      }
    })
  }

  async #updatePositions(opts?: {
    chainIds?: bigint[]
    maxDataAgeMs?: number
    forceUpdate?: boolean
    /**
     * Used for specific testing purposes only.
     */
    forceDebankCall?: boolean
  }) {
    const { chainIds, maxDataAgeMs, forceUpdate, forceDebankCall } = opts || {}
    const selectedAccount = this.#selectedAccount.account
    if (!selectedAccount) return

    const selectedAccountAddr = selectedAccount.addr
    const networksToUpdate = chainIds
      ? this.#networks.allNetworks.filter((n) => chainIds.includes(n.chainId))
      : this.#networks.allNetworks

    this.#initState(selectedAccountAddr, networksToUpdate)

    if (this.#getShouldSkipUpdate(selectedAccountAddr, maxDataAgeMs, forceUpdate)) return
    if (this.#getShouldSkipUpdateOnAccountWithNoDefiPositions(selectedAccount, forceUpdate)) return

    // Set all networks to loading
    networksToUpdate.forEach((n) => {
      this.#state[selectedAccountAddr][n.chainId.toString()].isLoading = true
    })

    this.emitUpdate()

    let debankPositions: PositionsByProvider[] | null = null

    // Skip Debank call in testing mode — only fetch custom DeFi positions
    if (process.env.IS_TESTING !== 'true' || forceDebankCall) {
      try {
        debankPositions = await this.getDebankPositionsForAccount(selectedAccountAddr, forceUpdate)
      } catch (err: any) {
        this.emitError({
          message: `Failed to fetch DeFi positions from Debank for ${selectedAccountAddr}`,
          error: err,
          level: 'silent'
        })
      }
    } else {
      // Null means an error occurred when fetching from Debank
      // so we must set it to an empty array if the call was skipped
      debankPositions = []
    }

    await Promise.all(
      networksToUpdate.map((n) => this.#updateSingleNetwork(n, selectedAccount, debankPositions))
    )
    await this.#updateNetworksWithPositions(selectedAccountAddr, this.#state[selectedAccountAddr])

    this.emitUpdate()
  }

  /**
   * Fetches the USD prices for the assets in the provided positions
   * using cena and updates the positions with the fetched prices and values.
   *
   * Note: It's private so we can mock it in tests.
   */
  private async updatePositionsByProviderAssetPrices(
    positionsByProvider: PositionsByProvider[],
    chainId: bigint
  ) {
    const platformId = this.#networks.allNetworks.find((n) => n.chainId === chainId)?.platformId

    // If we can't determine the Gecko platform ID, we shouldn't make a request to price (cena.ambire.com)
    // since it would return nothing.
    // This can happen when adding a custom network that doesn't have a CoinGecko platform ID.
    if (!platformId) return null

    const dedup = (x: any[]) => x.filter((y, i) => x.indexOf(y) === i)

    const addresses: string[] = []

    positionsByProvider.forEach((providerPos) => {
      providerPos.positions.forEach((p) => {
        p.assets.forEach((a) => {
          addresses.push(a.address)
        })
      })
    })

    const cenaUrl = `https://cena.ambire.com/api/v3/simple/token_price/${platformId}?contract_addresses=${dedup(
      addresses
    ).join('%2C')}&vs_currencies=usd`

    const resp = await fetchWithTimeout(this.#fetch, cenaUrl, {}, 3000)
    const body = await resp.json()
    if (resp.status !== 200) throw body
    // eslint-disable-next-line no-prototype-builtins
    if (body.hasOwnProperty('message')) throw body
    // eslint-disable-next-line no-prototype-builtins
    if (body.hasOwnProperty('error')) throw body

    const positionsByProviderWithPrices = positionsByProvider.map((posByProvider) => {
      if (getProviderId(posByProvider.providerName).includes('aave')) return posByProvider

      const updatedPositions = posByProvider.positions.map((position) => {
        let positionInUSD = position.additionalData.positionInUSD || 0

        const updatedAssets = position.assets.map((asset) => {
          const priceData = body[asset.address.toLowerCase()]
          if (!priceData) return asset

          const priceIn = Object.entries(priceData).map(([currency, price]) => ({
            baseCurrency: currency,
            price: price as number
          }))

          const value = getAssetValue(asset.amount, asset.decimals, priceIn) || 0

          positionInUSD += value

          return { ...asset, value, priceIn: priceIn[0] }
        })

        return {
          ...position,
          assets: updatedAssets,
          additionalData: { ...position.additionalData, positionInUSD }
        }
      })

      let positionInUSD = posByProvider.positionInUSD

      // Already set in the corresponding lib
      if (!positionInUSD) {
        positionInUSD = updatedPositions.reduce((prevPositionValue, position) => {
          return prevPositionValue + (position.additionalData.positionInUSD || 0)
        }, 0)
      }

      return { ...posByProvider, positions: updatedPositions, positionInUSD }
    })

    return positionsByProviderWithPrices
  }

  #getShouldSkipUpdateOnAccountWithNoDefiPositions(acc: Account, forceUpdate?: boolean) {
    if (forceUpdate) return false
    if (!this.#accounts.accountStates[acc.addr]) return false
    if (!this.#state[acc.addr]) return false
    // Don't skip if the account has any DeFi positions or the account has never been updated
    if (
      Object.values(this.#state[acc.addr]).some(
        (network) => network.positionsByProvider.length || !network.updatedAt
      )
    )
      return false
    const someNonceIdChanged = Object.keys(this.#accounts.accountStates[acc.addr]).some(
      (chainId: string) => {
        const posNonceId = this.#state[acc.addr][chainId]?.nonceId
        const nonceId = this.#getNonceId(acc, chainId)

        if (!nonceId || !posNonceId) return false

        return nonceId !== posNonceId
      }
    )

    // Return false (don’t skip) if any nonceId has changed
    return !someNonceIdChanged
  }

  #getNonceId(acc: Account, chainId: bigint | string) {
    if (!this.#accounts.accountStates) return undefined
    if (!this.#accounts.accountStates[acc.addr]) return undefined

    const networkState = this.#accounts.accountStates[acc.addr][chainId.toString()]
    if (!networkState) return undefined

    const network = this.#networks.allNetworks.find((net) => net.chainId === chainId)
    if (!network) return undefined

    const baseAcc = getBaseAccount(acc, networkState, this.#keystore.getAccountKeys(acc), network)
    return baseAcc.getNonceId()
  }

  removeNetworkData(chainId: bigint) {
    Object.keys(this.#state).forEach((accountId) => {
      delete this.#state[accountId][chainId.toString()]
    })
    this.emitUpdate()
  }

  getDefiPositionsStateForAllNetworks(accountAddr: string) {
    // return defi positions for enabled and disabled networks
    return this.#state[accountAddr] || {}
  }

  getDefiPositionsState(accountAddr: string) {
    // return defi positions only for enabled networks
    return Object.entries(this.#state[accountAddr] || {}).reduce((acc, [chainId, networkState]) => {
      if (this.#networks.networks.find((n) => n.chainId.toString() === chainId)) {
        acc[chainId] = networkState
      }
      return acc
    }, {} as AccountState)
  }

  getNetworksWithPositions(accountAddr: string) {
    return this.#networksWithPositionsByAccounts[accountAddr] || []
  }

  removeAccountData(accountAddr: string) {
    delete this.#state[accountAddr]
    delete this.#networksWithPositionsByAccounts[accountAddr]
    this.#storage.set('networksWithPositionsByAccounts', this.#networksWithPositionsByAccounts)

    this.emitUpdate()
  }

  addSession(sessionId: string) {
    this.sessionIds = [...new Set([...this.sessionIds, sessionId])]
    this.emitUpdate()
  }

  removeSession(sessionId: string) {
    this.sessionIds = this.sessionIds.filter((id) => id !== sessionId)
    this.emitUpdate()
  }

  async positionsContinuousUpdate() {
    if (!this.#ui.views.length) {
      this.#positionsContinuousUpdateInterval.stop()
      return
    }

    const FIVE_MINUTES = 1000 * 60 * 5
    await this.updatePositions({ maxDataAgeMs: FIVE_MINUTES })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
