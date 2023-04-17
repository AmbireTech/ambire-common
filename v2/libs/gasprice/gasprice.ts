import { Provider } from 'ethers'

// @TODO return type
export async function getGasPriceRecommendations (provider: Provider, blockTag: string | number = -1): Promise<any> {
	const lastBlock = await provider.getBlock(blockTag, true)
	if (lastBlock == null) return null
	const isEIP1559 = !!lastBlock.baseFeePerGas
	console.log(lastBlock, isEIP1559)
}

// temporary test
const { JsonRpcProvider } = require('ethers')
const url = 'https://mainnet.infura.io/v3/d4319c39c4df452286d8bf6d10de28ae'
const provider = new JsonRpcProvider(url)
getGasPriceRecommendations(provider)
	.then(x => console.log(x))

