import { NetworkId } from '../../interfaces/network'
import { getAAVEPositions } from '../../libs/defiPositions/aaveV3'
import { Position } from '../../libs/defiPositions/types'
import { getUniV3Positions } from '../../libs/defiPositions/uniV3'
import { AccountsController } from '../accounts/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'

export class DefiPositionsController extends EventEmitter {
  #accounts: AccountsController

  #providers: ProvidersController

  #networks: NetworksController

  positions: Position[] = []

  isReady: boolean = false

  updateDefiPositionsStatus: 'INITIAL' | 'LOADING' = 'INITIAL'

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

    this.isReady = true
    this.emitUpdate()

    await this.updatePositions()
  }

  async updatePositions(networkId?: NetworkId) {
    if (!this.#accounts.selectedAccount) return

    this.updateDefiPositionsStatus = 'LOADING'
    this.emitUpdate()

    const networksToUpdate = networkId
      ? this.#networks.networks.filter((n) => n.id === networkId)
      : this.#networks.networks

    try {
      const uniV3PositionsPromises = networksToUpdate.map(async (n) => {
        return getUniV3Positions(
          this.#accounts.selectedAccount!,
          this.#providers.providers[n.id],
          n
        )
      })
      const aavePositionsPromises = networksToUpdate.map(async (n) => {
        return getAAVEPositions(this.#accounts.selectedAccount!, this.#providers.providers[n.id], n)
      })
      const positions = (
        await Promise.all([...uniV3PositionsPromises, ...aavePositionsPromises])
      ).filter(Boolean) as Position[][]

      this.positions = positions.flat()
    } catch (error) {
      // TODO: set a proper error
    }

    await this.#setAssetPrices()

    this.updateDefiPositionsStatus = 'INITIAL'
    this.emitUpdate()
  }

  async #setAssetPrices() {
    const mergedPositionsByNetwork = Object.values(
      this.positions.reduce(
        (
          acc: { [key: string]: { network: Position['network']; assets: Position['assets'] } },
          { network, assets }
        ) => {
          if (!acc[network]) acc[network] = { network, assets: [] }

          const existingAddresses = new Set(acc[network].assets.map((asset) => asset.address))
          assets.forEach((asset) => {
            if (!existingAddresses.has(asset.address)) {
              acc[network].assets.push(asset)
              existingAddresses.add(asset.address) // Mark this address as added
            }
          })

          return acc
        },
        {}
      )
    )

    const dedup = (x: any[]) => x.filter((y, i) => x.indexOf(y) === i)
    const cenaUrls = mergedPositionsByNetwork.map((pos) => ({
      networkId: pos.network.toLowerCase(),
      url: `https://cena.ambire.com/api/v3/simple/token_price/${pos.network.toLowerCase()}?contract_addresses=${dedup(
        pos.assets.map((a) => a.address)
      ).join('%2C')}&vs_currencies=usd`
    }))

    await Promise.all(
      cenaUrls.map(async ({ url, networkId }) => {
        try {
          const resp = await fetch(url)
          const body = await resp.json()
          if (resp.status !== 200) throw body
          // eslint-disable-next-line no-prototype-builtins
          if (body.hasOwnProperty('message')) throw body
          // eslint-disable-next-line no-prototype-builtins
          if (body.hasOwnProperty('error')) throw body

          this.positions = this.positions.map((pos) => {
            if (pos.network.toLowerCase() !== networkId) return pos
            return {
              ...pos,
              assets: pos.assets.map((a) => ({
                ...a,
                additionalData: { ...a.additionalData, priceIn: body[a.address.toLowerCase()] }
              }))
            }
          })
        } catch (error) {
          console.error(error)
        }
      })
    )
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
