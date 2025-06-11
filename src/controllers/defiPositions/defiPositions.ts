import { AccountId } from '../../interfaces/account'
import { Fetch } from '../../interfaces/fetch'
import { getAssetValue } from '../../libs/defiPositions/helpers'
import { getAAVEPositions } from '../../libs/defiPositions/providers'
import getAccountNetworksWithPositions from '../../libs/defiPositions/providers/helpers/networksWithPositions'
import {
  AccountState,
  DeFiPositionsError,
  DeFiPositionsState,
  NetworksWithPositionsByAccounts,
  PositionsByProvider,
  ProviderName
} from '../../libs/defiPositions/types'
import EventEmitter from '../eventEmitter/eventEmitter'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
// eslint-disable-next-line import/no-cycle
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { StorageController } from '../storage/storage'

export class DefiPositionsController extends EventEmitter {
  #selectedAccount: SelectedAccountController

  #providers: ProvidersController

  #networks: NetworksController

  #fetch: Fetch

  #storage: StorageController

  #minUpdateInterval: number = 60 * 1000 // 1 minute

  #state: DeFiPositionsState = {}

  #networksWithPositionsByAccounts: NetworksWithPositionsByAccounts = {}

  constructor({
    fetch,
    storage,
    selectedAccount,
    providers,
    networks
  }: {
    fetch: Fetch
    storage: StorageController
    selectedAccount: SelectedAccountController
    providers: ProvidersController
    networks: NetworksController
  }) {
    super()

    this.#fetch = fetch
    this.#storage = storage
    this.#selectedAccount = selectedAccount
    this.#providers = providers
    this.#networks = networks
  }

  #setProviderError(
    accountAddr: string,
    chainId: bigint,
    providerName: ProviderName,
    errorMessage: string
  ) {
    if (!this.#state[accountAddr][chainId.toString()].providerErrors) {
      this.#state[accountAddr][chainId.toString()].providerErrors = []
    }

    this.#state[accountAddr][chainId.toString()].providerErrors!.push({
      providerName,
      error: errorMessage
    })
  }

  #getCanSkipUpdate(accountAddr: string, chainId: bigint, maxDataAgeMs = this.#minUpdateInterval) {
    const networkState = this.#state[accountAddr][chainId.toString()]
    if (!networkState.updatedAt) return false

    if (networkState.error || networkState.providerErrors?.length) return false
    const isWithinMinUpdateInterval =
      networkState.updatedAt && Date.now() - networkState.updatedAt < maxDataAgeMs

    return isWithinMinUpdateInterval || networkState.isLoading
  }

  async #updateNetworksWithPositions(accountId: AccountId, accountState: AccountState) {
    const storageStateByAccount = await this.#storage.get('networksWithPositionsByAccounts', {})

    this.#networksWithPositionsByAccounts[accountId] = getAccountNetworksWithPositions(
      accountId,
      accountState,
      storageStateByAccount,
      this.#providers.providers
    )

    this.emitUpdate()
    await this.#storage.set(
      'networksWithPositionsByAccounts',
      this.#networksWithPositionsByAccounts
    )
  }

  async updatePositions(opts?: { chainId?: bigint; maxDataAgeMs?: number }) {
    const { chainId, maxDataAgeMs } = opts || {}
    if (!this.#selectedAccount.account) return

    const selectedAccountAddr = this.#selectedAccount.account.addr
    const networksToUpdate = chainId
      ? this.#networks.networks.filter((n) => n.chainId === chainId)
      : this.#networks.networks

    if (!this.#state[selectedAccountAddr]) {
      this.#state[selectedAccountAddr] = {}
    }

    const initNetworkState = (addr: string, chain: string) => {
      if (!this.#state[addr][chain]) {
        this.#state[addr][chain] = {
          isLoading: false,
          positionsByProvider: [],
          updatedAt: undefined
        }
      }
    }

    const prepareNetworks = () => {
      // eslint-disable-next-line no-restricted-syntax
      for (const n of networksToUpdate) {
        initNetworkState(selectedAccountAddr, n.chainId.toString())
        this.#state[selectedAccountAddr][n.chainId.toString()].isLoading = true
        this.#state[selectedAccountAddr][n.chainId.toString()].positionsByProvider = []
        this.#state[selectedAccountAddr][n.chainId.toString()].updatedAt = undefined
      }
    }

    const updateSingleNetwork = async (
      n: any,
      debankPositionsByProvider: PositionsByProvider[]
    ) => {
      initNetworkState(selectedAccountAddr, n.chainId.toString())

      if (this.#getCanSkipUpdate(selectedAccountAddr, n.chainId, maxDataAgeMs)) return

      const state = this.#state[selectedAccountAddr][n.chainId.toString()]
      state.isLoading = true
      state.providerErrors = []
      state.error = undefined
      this.emitUpdate()

      const previousPositions = state.positionsByProvider
      let customAavePosition: PositionsByProvider | null = null
      try {
        customAavePosition = await getAAVEPositions(
          selectedAccountAddr,
          this.#providers.providers[n.chainId.toString()],
          n
        ).catch((e) => {
          console.error('getAAVEPositions error:', e)
          this.#setProviderError(
            selectedAccountAddr,
            n.chainId,
            'AAVE v3',
            e?.message || 'Unknown error'
          )
          return previousPositions.find((p) => p.providerName === 'AAVE v3') || null
        })

        if (customAavePosition) {
          const hasErrors = !!state.providerErrors?.length

          this.#state[selectedAccountAddr][n.chainId.toString()] = {
            ...state,
            isLoading: false,
            positionsByProvider: [customAavePosition],
            updatedAt: hasErrors ? state.updatedAt : Date.now()
          }

          await this.#setAssetPrices(selectedAccountAddr, n.chainId).catch((e) => {
            console.error(`#setAssetPrices error for ${selectedAccountAddr} on ${n.name}:`, e)
            this.#state[selectedAccountAddr][n.chainId.toString()].error =
              DeFiPositionsError.AssetPriceError
          })
        }
      } catch (e) {
        console.error(`updatePositions error on ${n.name}`, e)
        this.#state[selectedAccountAddr][n.chainId.toString()] = {
          isLoading: false,
          positionsByProvider: previousPositions || [],
          error: DeFiPositionsError.CriticalError
        }
      }

      // Update with latest fetched positions if available
      const chainPositions = debankPositionsByProvider.filter(
        (p) => String(p.chainId) === String(n.chainId)
      )

      let positionsByProvider = chainPositions

      if (customAavePosition) {
        positionsByProvider = positionsByProvider.filter(
          (p) => p.providerName.toLowerCase() !== customAavePosition!.providerName.toLowerCase()
        )
        positionsByProvider.push(customAavePosition)
      }

      this.#state[selectedAccountAddr][n.chainId.toString()] = {
        isLoading: false,
        positionsByProvider,
        updatedAt: Date.now() // use `body.timestamp` if needed
      }
    }

    prepareNetworks()

    try {
      const resp = await this.#fetch(`https://cena.ambire.com/api/v3/defi/${selectedAccountAddr}`)
      const body = await resp.json()
      if (resp.status !== 200 || body?.message || body?.error) throw body

      const positionsByProvider = (body.data as PositionsByProvider[]) || []

      await Promise.all(networksToUpdate.map((n) => updateSingleNetwork(n, positionsByProvider)))
    } catch (err) {
      console.error('Top-level fetch error:', err)

      await Promise.all(
        networksToUpdate.map(async (n) => {
          initNetworkState(selectedAccountAddr, n.chainId.toString())

          if (this.#getCanSkipUpdate(selectedAccountAddr, n.chainId, maxDataAgeMs)) return

          this.#state[selectedAccountAddr][n.chainId.toString()].isLoading = true
          this.#state[selectedAccountAddr][n.chainId.toString()].providerErrors = []
          this.#state[selectedAccountAddr][n.chainId.toString()].error = undefined
        })
      )
    } finally {
      this.emitUpdate()
    }

    // If this function is ever deleted, we should add an emitUpdate after the Promise.all
    // to ensure the UI is updated when the user changes the selected account and the positions
    // are retrieved from cache.
    await this.#updateNetworksWithPositions(selectedAccountAddr, this.#state[selectedAccountAddr])
  }

  async #setAssetPrices(accountAddr: string, chainId: bigint) {
    const platformId = this.#networks.networks.find((n) => n.chainId === chainId)?.platformId

    // If we can't determine the Gecko platform ID, we shouldn't make a request to price (cena.ambire.com)
    // since it would return nothing.
    // This can happen when adding a custom network that doesn't have a CoinGecko platform ID.
    if (!platformId) throw new Error('Missing `platformId`')

    const dedup = (x: any[]) => x.filter((y, i) => x.indexOf(y) === i)

    const networkState = this.#state[accountAddr][chainId.toString()]

    const addresses: string[] = []

    networkState.positionsByProvider.forEach((providerPos) => {
      providerPos.positions.forEach((p) => {
        p.assets.forEach((a) => {
          addresses.push(a.address)
        })
      })
    })

    const cenaUrl = `https://cena.ambire.com/api/v3/simple/token_price/${platformId}?contract_addresses=${dedup(
      addresses
    ).join('%2C')}&vs_currencies=usd`

    const resp = await this.#fetch(cenaUrl)
    const body = await resp.json()
    if (resp.status !== 200) throw body
    // eslint-disable-next-line no-prototype-builtins
    if (body.hasOwnProperty('message')) throw body
    // eslint-disable-next-line no-prototype-builtins
    if (body.hasOwnProperty('error')) throw body

    const positionsByProviderWithPrices = this.#state[accountAddr][
      chainId.toString()
    ].positionsByProvider.map((positionsByProvider) => {
      if (positionsByProvider.providerName.toLowerCase().includes('aave'))
        return positionsByProvider

      const updatedPositions = positionsByProvider.positions.map((position) => {
        let positionInUSD = position.additionalData.positionInUSD || 0

        const updatedAssets = position.assets.map((asset) => {
          const priceData = body[asset.address.toLowerCase()]
          if (!priceData) return asset

          const priceIn = Object.entries(priceData).map(([currency, price]) => ({
            baseCurrency: currency,
            price: price as number
          }))

          const value = getAssetValue(asset.amount, asset.decimals, priceIn)

          positionInUSD += value

          return { ...asset, value, priceIn: priceIn[0] }
        })

        return {
          ...position,
          assets: updatedAssets,
          additionalData: { ...position.additionalData, positionInUSD }
        }
      })

      let positionInUSD = positionsByProvider.positionInUSD

      // Already set in the corresponding lib
      if (!positionInUSD) {
        positionInUSD = updatedPositions.reduce((prevPositionValue, position) => {
          return prevPositionValue + (position.additionalData.positionInUSD || 0)
        }, 0)
      }

      return { ...positionsByProvider, positions: updatedPositions, positionInUSD }
    })

    this.#state[accountAddr][chainId.toString()].positionsByProvider = positionsByProviderWithPrices
  }

  removeNetworkData(chainId: bigint) {
    Object.keys(this.#state).forEach((accountId) => {
      delete this.#state[accountId][chainId.toString()]
    })
    this.emitUpdate()
  }

  getDefiPositionsState(accountAddr: string) {
    return this.#state[accountAddr] || {}
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

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
