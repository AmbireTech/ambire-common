import { Portfolio } from '../libs/portfolio'
import { Storage } from '../interfaces/storage'
import { NetworkDescriptor } from '../interfaces/networkDescriptor'
import { Account } from '../interfaces/account'
import { AccountOp } from '../libs/accountOp/accountOp'

type NetworkId = string
type AccountId = string
// @TODO fix the any
type PortfolioState = Map<AccountId, Map<NetworkId, any>>

class PortfolioController {
	latest: PortfolioState
	pending: PortfolioState

	constructor(storage: Storage) {
		this.latest = new Map()
		this.pending = new Map()
	}
	// NOTE: we always pass in all `accounts` and `networks` to ensure that the user of this
	// controller doesn't have to update this controller every time that those are updated

	// The recommended behavior of the application that this API encourages is:
	// 1) when the user selects an account, update it's portfolio on all networks (latest state only) by calling updateSelectedAccount
	// 2) every time the user has a change in their pending (to be signed or to be mined) bundle(s) on a
	// certain network, call updateSelectedAccount again with those bundles; it will update the portfolio balance
	// on each network where there are bundles, and it will update both `latest` and `pending` states on said networks
	// it will also use a high `priceRecency` to make sure we don't lose time in updating prices (since we care about running the simulations)

	// the purpose of this function is to call it when an account is selected or the queue of accountOps changes
	async updateSelectedAccount(accounts: Account[], networks: NetworkDescriptor[], accountId: AccountId, accountOps: AccountOp[]) {
		const selectedAccount = accounts.find(x => x.addr === accountId)
		if (!selectedAccount) throw new Error('selected account does not exist')
		if (!this.latest.has(accountId)) this.latest.set(accountId, new Map())
		await Promise.all(networks.map(async network => {
			console.log(network)
		}))
		// console.log(accounts, networks, accountOps)

	}
	// @TODO every time we update on one network, update both pending and latest but with high priceRecency
	// @TODO: come up with a new name for this function - it's purpose is to always call it when we have a change in transaction state
	// updatePendingOnOneNetwork(accounts, networks, accountId, networkId, simulationBundles)
}



// @TODO: move this into utils
function produceMemoryStore(): Storage {
        const storage = new Map()
        return {
                get: (key, defaultValue): any => {
                        const serialized = storage.get(key)
                        return  Promise.resolve(serialized ? JSON.parse(serialized) : defaultValue)
                },
                set: (key, value) => { storage.set(key, JSON.stringify(value)); return Promise.resolve(null) }
        }
}

import { networks } from '../consts/networks'
const account = {
	addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
	label: '',
	pfp: '',
	associatedKeys: [],
	factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
	bytecode: '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
	salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
}

const controller = new PortfolioController(produceMemoryStore())
controller.updateSelectedAccount([account], networks, account.addr, [])
