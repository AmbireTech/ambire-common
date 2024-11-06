import { NetworkId } from '../../interfaces/network'
import { getNetworksWithDeFiPositionsErrorBanners } from '../../libs/banners/banners'
import { getAAVEPositions, getUniV3Positions } from '../../libs/defiPositions/providers'
import { DeFiPositionsState, PositionsByProvider } from '../../libs/defiPositions/types'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'
import { AccountsController } from '../accounts/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'

export class DefiPositionsController extends EventEmitter {
  #accounts: AccountsController

  #providers: ProvidersController

  #networks: NetworksController

  state: DeFiPositionsState = {}

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor({
    accounts,
    providers,
    networks
  }: {
    accounts: AccountsController
    providers: ProvidersController
    networks: NetworksController
  }) {
    super()

    this.#accounts = accounts
    this.#providers = providers
    this.#networks = networks
    this.initialLoadPromise = this.#load()
  }

  async #load() {
    await this.#accounts.initialLoadPromise
    await this.#networks.initialLoadPromise
    await this.#providers.initialLoadPromise

    await this.updatePositions()
  }

  #initInitialAccountStateIfNeeded(accountAddr: string) {
    if (!this.state[accountAddr]) {
      this.state[accountAddr] = this.#networks.networks.reduce(
        (acc, n) => ({ ...acc, [n.id]: { isLoading: true, positionsByProvider: [] } }),
        this.state[accountAddr]
      )

      this.emitUpdate()
    }
  }

  #setProviderError(
    accountAddr: string,
    networkId: string,
    providerName: string,
    errorMessage: string
  ) {
    if (!this.state[accountAddr][networkId].providerErrors) {
      this.state[accountAddr][networkId].providerErrors = []
    }

    this.state[accountAddr][networkId].providerErrors!.push({
      providerName,
      error: errorMessage
    })
  }

  async updatePositions(networkId?: NetworkId) {
    const selectedAccountAddr = this.#accounts.selectedAccount
    if (!selectedAccountAddr) {
      console.error('updatePositions: no selected account')
      return
    }

    this.#initInitialAccountStateIfNeeded(selectedAccountAddr)

    const networksToUpdate = networkId
      ? this.#networks.networks.filter((n) => n.id === networkId)
      : this.#networks.networks

    networksToUpdate.map(async (n) => {
      try {
        const [aavePositions, uniV3Positions] = [
          await getAAVEPositions(
            this.#accounts.selectedAccount!,
            this.#providers.providers[n.id],
            n
          ).catch((e) => {
            console.error('getAAVEPositions error:', e)
            this.#setProviderError(
              selectedAccountAddr,
              n.id,
              'AAVE v3',
              e?.message || 'Unknown error'
            )

            return null
          }),
          await getUniV3Positions(
            this.#accounts.selectedAccount!,
            this.#providers.providers[n.id],
            n
          ).catch((e) => {
            console.error('getUniV3Positions error:', e)

            this.#setProviderError(
              selectedAccountAddr,
              n.id,
              'Uniswap V3',
              e?.message || 'Unknown error'
            )

            return null
          })
        ]

        this.state[selectedAccountAddr][n.id] = {
          ...this.state[selectedAccountAddr][n.id],
          isLoading: false,
          positionsByProvider: [aavePositions, uniV3Positions].filter(
            Boolean
          ) as PositionsByProvider[]
        }
        await this.#setAssetPrices(selectedAccountAddr, n.id)
      } catch (e: any) {
        const prevPositionsByProvider = this.state[selectedAccountAddr][n.id].positionsByProvider
        this.state[selectedAccountAddr][n.id] = {
          isLoading: false,
          positionsByProvider: prevPositionsByProvider || [],
          criticalError: e?.message || 'Unknown error'
        }
        console.error(`updatePositions error on ${n.id}`, e)
      } finally {
        this.emitUpdate()
      }
    })
  }

  async #setAssetPrices(accountAddr: string, networkId: string) {
    const dedup = (x: any[]) => x.filter((y, i) => x.indexOf(y) === i)

    const networkState = this.state[accountAddr][networkId]

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
      const resp = await fetch(cenaUrl)
      const body = await resp.json()
      if (resp.status !== 200) throw body
      // eslint-disable-next-line no-prototype-builtins
      if (body.hasOwnProperty('message')) throw body
      // eslint-disable-next-line no-prototype-builtins
      if (body.hasOwnProperty('error')) throw body

      const positionsByProviderWithPrices = this.state[accountAddr][
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

            const priceInUSD = priceIn.find((p) => p.baseCurrency === 'usd')?.price
            if (!priceInUSD) return asset

            const assetValue = safeTokenAmountAndNumberMultiplication(
              asset.amount,
              asset.decimals,
              priceInUSD
            )

            positionInUSD += Number(assetValue)

            return {
              ...asset,
              priceIn
            }
          })

          return {
            ...position,
            assets: updatedAssets,
            additionalData: {
              positionInUSD
            }
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

      this.state[accountAddr][networkId].positionsByProvider = positionsByProviderWithPrices
    } catch (error) {
      console.error('#setAssetPrices error in defiPositions:', error)
    }
  }

  get banners() {
    if (!this.#accounts.selectedAccount) return []

    const errorBanners = getNetworksWithDeFiPositionsErrorBanners({
      networks: this.#networks.networks,
      currentAccountState: this.state[this.#accounts.selectedAccount],
      providers: this.#providers.providers
    })

    return errorBanners
  }

  get selectedAccountPositions() {
    if (!this.#accounts.selectedAccount) return null

    return Object.values(this.state[this.#accounts.selectedAccount] || {}).flatMap(
      (n) => n.positionsByProvider
    )
  }

  get isSelectedAccountLoading() {
    if (!this.#accounts.selectedAccount) return false

    return Object.values(this.state[this.#accounts.selectedAccount] || {}).some((n) => n.isLoading)
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      selectedAccountPositions: this.selectedAccountPositions,
      isSelectedAccountLoading: this.isSelectedAccountLoading,
      banners: this.banners
    }
  }
}
