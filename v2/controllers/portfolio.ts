import { Portfolio } from '../libs/portfolio'
import { Storage } from '../interfaces/storage'

type networkId = string
type accountId = string
// @TODO fix the any
type PortfolioState = Map<accountId, Map<networkId, any>>

class PortfolioController {
	latest: PortfolioState
	pending: PortfolioState

	constructor(storage: Storage) {
		this.latest = new Map()
		this.pending = new Map()
		// NOTE: we always pass in all `accounts` and `networks` to ensure that the user of this
		// controller doesn't have to update this controller every time that those are updated
		/*
		updateAccountOnAllNetworks(accounts, networks, accountId)
		updateAccountOnOneNetworkWithSimulation(accounts, networks, accountId, networkId, simulationBundles)
		
		*/
	}
}
