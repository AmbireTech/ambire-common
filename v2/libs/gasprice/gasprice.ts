import { Provider } from 'ethers'

// https://eips.ethereum.org/EIPS/eip-1559
const BASE_FEE_MAX_CHANGE_DENOMINATOR = 8n
const ELASTICITY_MULTIPLIER = 2n

// multipliers from the old: https://github.com/AmbireTech/relayer/blob/wallet-v2/src/utils/gasOracle.js#L64-L76
// 2x, 2x*0.4, 2x*0.2 - all of them divided by 8 so 0.25, 0.1, 0.05 - those seem usable; with a slight tweak for the ape
// @TODO we may not use the gasPriceMultiplierBps in this form
const speeds = [
	{ name: 'slow', baseFeeAddBps: 0n, gasPriceMultiplierBps: 9000n },	
	{ name: 'medium', baseFeeAddBps: 500n, gasPriceMultiplierBps: 10000n },
	{ name: 'fast', baseFeeAddBps: 1000n, gasPriceMultiplierBps: 11000n },	
	{ name: 'ape', baseFeeAddBps: 1500n, gasPriceMultiplierBps: 11500n },
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
		const getBaseFeeDelta = (delta: bigint) => baseFeePerGas * delta / gasTarget / BASE_FEE_MAX_CHANGE_DENOMINATOR
		let expectedBaseFee = baseFeePerGas
		if (lastBlock.gasUsed > gasTarget) {
			const baseFeeDelta = getBaseFeeDelta(lastBlock.gasUsed - gasTarget)
			expectedBaseFee += baseFeeDelta === 0n ? 1n : baseFeeDelta
		} else if (lastBlock.gasUsed < gasTarget) {
			const baseFeeDelta = getBaseFeeDelta(gasTarget - lastBlock.gasUsed)
			expectedBaseFee -= baseFeeDelta
		}

		return speeds.map(({ name, baseFeeAddBps }) => ({
			name,
			baseFeePerGas: expectedBaseFee + expectedBaseFee * baseFeeAddBps / 10000n
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

