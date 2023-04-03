// @TODO type for provider
// @TODO proxy pattern and/or define all methods for an abi, return an object
import { Interface } from 'ethers/lib/utils'

export class Deployless {
	isLimitedAt24kbData: boolean;
	// to allow for the dynamically added properties
	[key: string]: any;

	constructor (abi: any, code: string) {
		// true until we can test it
		this.isLimitedAt24kbData = true
	
		const iface = new Interface(abi)
		for (const item of abi) {
			if (item.type !== 'function') continue
			this[item.name] = (...args) => {
				console.log(args)
			}
		}
	}
}
