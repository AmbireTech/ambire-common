import { Provider } from 'ethers'

// https://eips.ethereum.org/EIPS/eip-1559
const BASE_FEE_MAX_CHANGE_DENOMINATOR = 8n
const ELASTICITY_MULTIPLIER = 2n

// multipliers from the old: https://github.com/AmbireTech/relayer/blob/wallet-v2/src/utils/gasOracle.js#L64-L76
// 2x, 2x*0.4, 2x*0.2 - all of them divided by 8 so 0.25, 0.1, 0.05 - those seem usable; with a slight tweak for the ape
const speeds = [
	{ name: 'slow', baseFeeMultiplierBps: 0n },	
	{ name: 'medium', baseFeeMultiplierBps: 500n },	
	{ name: 'fast', baseFeeMultiplierBps: 1000n },	
	{ name: 'ape', baseFeeMultiplierBps: 1500n },	
]



// @TODO return type
export async function getGasPriceRecommendations (provider: Provider, blockTag: string | number = -1): Promise<any> {
	const lastBlock = await provider.getBlock(blockTag, true)
	if (lastBlock == null) return null
	// console.log(lastBlock, lastBlock.prefetchedTransactions, isEIP1559)
	if (lastBlock.baseFeePerGas != null) {
		// https://eips.ethereum.org/EIPS/eip-1559
		const gasTarget = lastBlock.gasLimit / ELASTICITY_MULTIPLIER
		const baseFeePerGas = lastBlock.baseFeePerGas
		let expectedBaseFee = baseFeePerGas
		if (lastBlock.gasUsed > gasTarget) {
			const delta = lastBlock.gasUsed - gasTarget
			const baseFeeDelta = lastBlock.baseFeePerGas * delta / gasTarget / BASE_FEE_MAX_CHANGE_DENOMINATOR
			expectedBaseFee += baseFeeDelta === 0n ? 1n : baseFeeDelta
		} else if (lastBlock.gasUsed < gasTarget) {
			const delta = gasTarget - lastBlock.gasUsed
			const baseFeeDelta = lastBlock.baseFeePerGas * delta / gasTarget / BASE_FEE_MAX_CHANGE_DENOMINATOR
			expectedBaseFee -= baseFeeDelta
		}

		return speeds.map(({ name, baseFeeMultiplierBps }) => ({
			name,
			baseFeePerGas: expectedBaseFee + expectedBaseFee * baseFeeMultiplierBps / 10000n
		}))
	} else {
		const txns = lastBlock.prefetchedTransactions.filter(x => x.gasPrice > 0)
		// console.log(txns.map(x => x.gasPrice))
		// console.log(lastBlock)
	}
}

// temporary test
const { JsonRpcProvider } = require('ethers')
const provider = new JsonRpcProvider('https://mainnet.infura.io/v3/d4319c39c4df452286d8bf6d10de28ae')
getGasPriceRecommendations(provider)
	.then(x => console.log('ethereum', x))

getGasPriceRecommendations(new JsonRpcProvider('https://bsc-dataseed1.binance.org'))
	.then(x => console.log('bsc', x))

