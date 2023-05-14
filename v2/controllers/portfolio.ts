import { Portfolio } from '../libs/portfolio'
import { Storage } from '../interfaces/storage'

class PortfolioController {
	constructor(storage: Storage) {
		// NOTE: we always pass in all `accounts` and `networks` to ensure that the user of this
		// controller doesn't have to update this controller every time that those are updated
		/*
		updateAccountOnAllNetworks(accounts, networks, accountId)
		updateAccountOnOneNetworkWithSimulation(accounts, networks, accountId, networkId, simulationBundles)
		
		*/
	}
}
