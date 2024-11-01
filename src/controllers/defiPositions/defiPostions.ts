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

    this.updateDefiPositionsStatus = 'INITIAL'
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
