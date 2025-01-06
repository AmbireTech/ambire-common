import { AccountId } from '../../interfaces/account'
import { Fetch } from '../../interfaces/fetch'
import { NetworkId } from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import { getAssetValue } from '../../libs/defiPositions/helpers'
import { getAAVEPositions, getUniV3Positions } from '../../libs/defiPositions/providers'
import getAccountNetworksWithPositions from '../../libs/defiPositions/providers/helpers/networksWithPositions'
import {
  AccountState,
  DeFiPositionsError,
  DeFiPositionsState,
  NetworksWithPositionsByAccounts,
  PositionsByProvider
} from '../../libs/defiPositions/types'
import EventEmitter from '../eventEmitter/eventEmitter'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
// eslint-disable-next-line import/no-cycle
import { SelectedAccountController } from '../selectedAccount/selectedAccount'

export class DefiPositionsController extends EventEmitter {
  #selectedAccount: SelectedAccountController

  #providers: ProvidersController

  #networks: NetworksController

  #fetch: Fetch

  #storage: Storage

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
    storage: Storage
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
    networkId: string,
    providerName: string,
    errorMessage: string
  ) {
    if (!this.#state[accountAddr][networkId].providerErrors) {
      this.#state[accountAddr][networkId].providerErrors = []
    }

    this.#state[accountAddr][networkId].providerErrors!.push({
      providerName,
      error: errorMessage
    })
  }

  #getCanSkipUpdate(accountAddr: string, networkId: string) {
    const networkState = this.#state[accountAddr][networkId]

    if (networkState.error || networkState.providerErrors?.length) return false
    const isWithinMinUpdateInterval =
      networkState.updatedAt && Date.now() - networkState.updatedAt < this.#minUpdateInterval

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

  async updatePositions(networkId?: NetworkId) {
    if (!this.#selectedAccount.account) return

    const selectedAccountAddr = this.#selectedAccount.account.addr
    const networksToUpdate = networkId
      ? this.#networks.networks.filter((n) => n.id === networkId)
      : this.#networks.networks

    if (!this.#state[selectedAccountAddr]) {
      this.#state[selectedAccountAddr] = {}
    }

    await Promise.all(
      networksToUpdate.map(async (n) => {
        if (!this.#state[selectedAccountAddr][n.id]) {
          this.#state[selectedAccountAddr][n.id] = {
            isLoading: false,
            positionsByProvider: [],
            updatedAt: undefined
          }
        }

        if (this.#getCanSkipUpdate(selectedAccountAddr, n.id)) {
          // Emit an update so that the current account data getter is updated
          this.emitUpdate()
          return
        }

        this.#state[selectedAccountAddr][n.id].isLoading = true
        this.emitUpdate()

        const networkState = this.#state[selectedAccountAddr][n.id]
        // Reset provider errors before updating
        networkState.providerErrors = []
        networkState.error = undefined

        try {
          const [aavePositions, uniV3Positions] = await Promise.all([
            getAAVEPositions(selectedAccountAddr, this.#providers.providers[n.id], n).catch(
              (e: any) => {
                console.error('getAAVEPositions error:', e)
                this.#setProviderError(
                  selectedAccountAddr,
                  n.id,
                  'AAVE v3',
                  e?.message || 'Unknown error'
                )

                return null
              }
            ),
            getUniV3Positions(selectedAccountAddr, this.#providers.providers[n.id], n).catch(
              (e: any) => {
                console.error('getUniV3Positions error:', e)

                this.#setProviderError(
                  selectedAccountAddr,
                  n.id,
                  'Uniswap V3',
                  e?.message || 'Unknown error'
                )

                return null
              }
            )
          ])

          this.#state[selectedAccountAddr][n.id] = {
            ...networkState,
            isLoading: false,
            positionsByProvider: [aavePositions, uniV3Positions].filter(
              Boolean
            ) as PositionsByProvider[],
            updatedAt: Date.now()
          }
          await this.#setAssetPrices(selectedAccountAddr, n.id).catch((e) => {
            console.error('#setAssetPrices error:', e)
            this.#state[selectedAccountAddr][n.id].error = DeFiPositionsError.AssetPriceError
          })
        } catch (e: any) {
          const prevPositionsByProvider = networkState.positionsByProvider
          this.#state[selectedAccountAddr][n.id] = {
            isLoading: false,
            positionsByProvider: prevPositionsByProvider || [],
            error: DeFiPositionsError.CriticalError
          }
          console.error(`updatePositions error on ${n.id}`, e)
        } finally {
          this.emitUpdate()
        }
      })
    )

    await this.#updateNetworksWithPositions(selectedAccountAddr, this.#state[selectedAccountAddr])
  }

  async #setAssetPrices(accountAddr: string, networkId: string) {
    const dedup = (x: any[]) => x.filter((y, i) => x.indexOf(y) === i)

    const networkState = this.#state[accountAddr][networkId]

    const addresses: string[] = []

    networkState.positionsByProvider.forEach((providerPos) => {
      providerPos.positions.forEach((p) => {
        p.assets.forEach((a) => {
          addresses.push(a.address)
        })
      })
    })

    const cenaUrl = `https://cena.ambire.com/api/v3/simple/token_price/${
      this.#networks.networks.find((n) => n.id === networkId)?.platformId
    }?contract_addresses=${dedup(addresses).join('%2C')}&vs_currencies=usd`

    try {
      const resp = await this.#fetch(cenaUrl)
      const body = await resp.json()
      if (resp.status !== 200) throw body
      // eslint-disable-next-line no-prototype-builtins
      if (body.hasOwnProperty('message')) throw body
      // eslint-disable-next-line no-prototype-builtins
      if (body.hasOwnProperty('error')) throw body

      const positionsByProviderWithPrices = this.#state[accountAddr][
        networkId
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

            return {
              ...asset,
              value,
              priceIn
            }
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

      this.#state[accountAddr][networkId].positionsByProvider = positionsByProviderWithPrices
    } catch (error) {
      console.error('#setAssetPrices error in defiPositions:', error)
    }
  }

  removeNetworkData(networkId: NetworkId) {
    Object.keys(this.#state).forEach((accountId) => {
      delete this.#state[accountId][networkId]
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
