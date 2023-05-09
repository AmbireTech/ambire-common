import { describe, expect, test } from '@jest/globals'
import { JsonRpcProvider } from 'ethers'
import { getGasPriceRecommendations } from './gasPrice'

describe('Gas price', () => {
	test('get gas price for an EIP1559 network', async () => {
		const provider = new JsonRpcProvider('https://mainnet.infura.io/v3/d4319c39c4df452286d8bf6d10de28ae')
		const recommendations = await getGasPriceRecommendations(provider)
		expect(recommendations.length).toBe(4)
		expect((recommendations[0] as any).baseFeePerGas).not.toBe(null)
		expect((recommendations[0] as any).maxPriorityFeePerGas).not.toBe(null)
	})

	test('get gas price for a non-EIP1559 network', async () => {
		const recommendations = await getGasPriceRecommendations(new JsonRpcProvider('https://bsc-dataseed1.binance.org'))
		expect(recommendations.length).toBe(4)
		expect((recommendations[0] as any).gasPrice).not.toBe(null)
	})
})
