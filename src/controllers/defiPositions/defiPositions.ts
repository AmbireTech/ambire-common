import { AccountId } from '../../interfaces/account'
import { Fetch } from '../../interfaces/fetch'
import { getAssetValue } from '../../libs/defiPositions/helpers'
import { getAAVEPositions, getUniV3Positions } from '../../libs/defiPositions/providers'
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
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
// eslint-disable-next-line import/no-cycle
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { StorageController } from '../storage/storage'

export class DefiPositionsController extends EventEmitter {
  #selectedAccount: SelectedAccountController

  #keystore: KeystoreController

  #providers: ProvidersController

  #networks: NetworksController

  #fetch: Fetch

  #storage: StorageController

  #minUpdateInterval: number = 60 * 1000 // 1 minute

  #state: DeFiPositionsState = {}

  #networksWithPositionsByAccounts: NetworksWithPositionsByAccounts = {}

  sessionIds: string[] = []

  constructor({
    fetch,
    storage,
    selectedAccount,
    keystore,
    providers,
    networks
  }: {
    fetch: Fetch
    storage: StorageController
    selectedAccount: SelectedAccountController
    keystore: KeystoreController
    providers: ProvidersController
    networks: NetworksController
  }) {
    super()

    this.#fetch = fetch
    this.#storage = storage
    this.#selectedAccount = selectedAccount
    this.#keystore = keystore
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

  #getShouldSkipUpdate(
    accountAddr: string,
    chainId: bigint,
    maxDataAgeMs = this.#minUpdateInterval,
    forceUpdate?: boolean
  ) {
    const hasKeys = this.#keystore.keys.some(({ addr }) =>
      this.#selectedAccount.account!.associatedKeys.includes(addr)
    )
    const shouldForceUpdatePositions = forceUpdate && this.sessionIds.length && hasKeys
    if (shouldForceUpdatePositions) maxDataAgeMs = 30000 // half a min

    const networkState = this.#state[accountAddr][chainId.toString()]
    console.log(
      chainId,
      'hasUpdatedAt:',
      !!networkState.updatedAt,
      'maxDataAgeMs:',
      maxDataAgeMs,
      'error:',
      networkState.error || networkState.providerErrors?.length,
      'isLoading:',
      networkState.isLoading,
      '<:',
      networkState.updatedAt && Date.now() - networkState.updatedAt < maxDataAgeMs
    )
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

  async updatePositions(opts?: { chainId?: bigint; maxDataAgeMs?: number; forceUpdate?: boolean }) {
    const { chainId, maxDataAgeMs, forceUpdate } = opts || {}
    const selectedAccount = this.#selectedAccount.account
    if (!selectedAccount) return

    const selectedAccountAddr = selectedAccount.addr
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
          updatedAt: undefined,
          providerErrors: []
        }
      }
    }

    const prepareNetworks = () => {
      // eslint-disable-next-line no-restricted-syntax
      for (const n of networksToUpdate) {
        const chain = n.chainId.toString()
        initNetworkState(selectedAccountAddr, chain)
      }
    }

    const lower = (s: string) => s.toLowerCase()

    const fetchCustomPositions = async (
      addr: string,
      provider: any,
      network: any,
      previous: PositionsByProvider[]
    ): Promise<PositionsByProvider[]> => {
      const [aave, uniV3] = await Promise.all([
        getAAVEPositions(addr, provider, network).catch((e: any) => {
          console.error('getAAVEPositions error:', e)
          this.#setProviderError(addr, network.chainId, 'AAVE v3', e?.message || 'Unknown error')
          return previous.find((p) => p.providerName === 'AAVE v3') || null
        }),
        getUniV3Positions(addr, provider, network).catch((e: any) => {
          console.error('getUniV3Positions error:', e)
          this.#setProviderError(addr, network.chainId, 'Uniswap V3', e?.message || 'Unknown error')
          return previous.find((p) => p.providerName === 'Uniswap V3') || null
        })
      ])

      return [aave, uniV3].filter(Boolean) as PositionsByProvider[]
    }

    const updateSingleNetwork = async (
      network: any,
      debankPositionsByProvider: PositionsByProvider[]
    ) => {
      const chain = network.chainId.toString()
      initNetworkState(selectedAccountAddr, chain)

      if (
        this.#getShouldSkipUpdate(selectedAccountAddr, network.chainId, maxDataAgeMs, forceUpdate)
      )
        return

      const state = this.#state[selectedAccountAddr][chain]
      Object.assign(state, {
        isLoading: true,
        providerErrors: [],
        error: undefined
      })
      this.emitUpdate()

      const previousPositions = state.positionsByProvider
      let customPositions: PositionsByProvider[] = []

      try {
        customPositions = await fetchCustomPositions(
          selectedAccountAddr,
          this.#providers.providers[chain],
          network,
          previousPositions
        )

        if (customPositions.length) {
          let error: any
          try {
            customPositions =
              (await this.#updatePositionsByProviderAssetPrices(
                customPositions,
                network.chainId
              )) || customPositions
          } catch (e) {
            console.error(`#setAssetPrices error for ${selectedAccountAddr} on ${network.name}:`, e)
            error = DeFiPositionsError.AssetPriceError
          }

          const hasErrors = !!state.providerErrors?.length
          const filteredPrevious = previousPositions.filter(
            (prev) =>
              !customPositions.some((c) => lower(c.providerName) === lower(prev.providerName))
          )

          this.#state[selectedAccountAddr][chain] = {
            ...state,
            isLoading: false,
            positionsByProvider: [...filteredPrevious, ...customPositions],
            updatedAt: hasErrors ? state.updatedAt : Date.now(),
            error
          }
        }
      } catch (e) {
        console.error(`updatePositions error on ${network.name}`, e)
        this.#state[selectedAccountAddr][chain] = {
          providerErrors: this.#state[selectedAccountAddr][chain].providerErrors || [],
          isLoading: false,
          positionsByProvider: previousPositions || [],
          error: DeFiPositionsError.CriticalError
        }
      }

      const positionsByProvider = debankPositionsByProvider.filter(
        (p) => String(p.chainId) === String(network.chainId)
      )

      const positionMap = new Map(positionsByProvider.map((p) => [lower(p.providerName), p]))

      // eslint-disable-next-line no-restricted-syntax
      for (const custom of customPositions) {
        const key = lower(custom.providerName)

        if (custom.providerName === 'Uniswap V3') {
          const debankUni = positionMap.get(key)
          if (debankUni) {
            const merged = {
              ...debankUni,
              positions: debankUni.positions.map((pos) => {
                const match = custom.positions.find(
                  (p) => p.id === pos.additionalData.positionIndex
                )
                return match
                  ? {
                      ...pos,
                      additionalData: {
                        ...pos.additionalData,
                        inRange: match.additionalData.inRange
                      }
                    }
                  : pos
              })
            } as PositionsByProvider

            positionMap.set(key, merged)
            // eslint-disable-next-line no-continue
            continue
          }
        }

        positionMap.set(key, custom)
      }

      this.#state[selectedAccountAddr][chain] = {
        providerErrors: this.#state[selectedAccountAddr][chain].providerErrors || [],
        isLoading: false,
        positionsByProvider: Array.from(positionMap.values()),
        updatedAt: Date.now()
      }
    }

    prepareNetworks()

    let debankPositions: PositionsByProvider[] = []

    // Skip Debank call in testing mode — only fetch custom DeFi positions
    if (process.env.IS_TESTING !== 'true') {
      try {
        const defiUrl = `https://cena.ambire.com/api/v3/defi/${selectedAccountAddr}`

        const hasKeys = this.#keystore.keys.some(({ addr }) =>
          this.#selectedAccount.account!.associatedKeys.includes(addr)
        )
        const shouldForceUpdatePositions = forceUpdate && this.sessionIds.length && hasKeys

        const resp = await this.#fetch(
          shouldForceUpdatePositions ? `${defiUrl}?update=true` : defiUrl
        )
        const body = await resp.json()
        if (resp.status !== 200 || body?.message || body?.error) throw body

        debankPositions = (body.data as PositionsByProvider[]) || []
      } catch (err) {
        console.error('Debank fetch failed:', err)
        // Proceed with empty debank positions
      }
    }

    await Promise.all(networksToUpdate.map((n) => updateSingleNetwork(n, debankPositions)))

    this.emitUpdate()

    await this.#updateNetworksWithPositions(selectedAccountAddr, this.#state[selectedAccountAddr])
  }

  async #updatePositionsByProviderAssetPrices(
    positionsByProvider: PositionsByProvider[],
    chainId: bigint
  ) {
    const platformId = this.#networks.networks.find((n) => n.chainId === chainId)?.platformId

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

    const resp = await this.#fetch(cenaUrl)
    const body = await resp.json()
    if (resp.status !== 200) throw body
    // eslint-disable-next-line no-prototype-builtins
    if (body.hasOwnProperty('message')) throw body
    // eslint-disable-next-line no-prototype-builtins
    if (body.hasOwnProperty('error')) throw body

    const positionsByProviderWithPrices = positionsByProvider.map((posByProvider) => {
      if (posByProvider.providerName.toLowerCase().includes('aave')) return posByProvider

      const updatedPositions = posByProvider.positions.map((position) => {
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

  addSession(sessionId: string) {
    this.sessionIds = [...new Set([...this.sessionIds, sessionId])]
    this.emitUpdate()
  }

  removeSession(sessionId: string) {
    this.sessionIds = this.sessionIds.filter((id) => id !== sessionId)
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
