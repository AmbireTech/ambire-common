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

		// The recommended behavior of the application that this API encourages is:
		// 1) when the user selects an account, update it's portfolio on all networks: updateAccountOnAllNetworks
		// 2) every time the user has a change in their pending (to be signed or to be mined) bundle(s) on a
		// certain network, update this network only: updateAccountOnOneNetwork
		/*
		updateAccountOnAllNetworks(accounts, networks, accountId)
		updateAccountOnOneNetwork(accounts, networks, accountId, networkId, simulationBundles)
		
		*/
	}
}
