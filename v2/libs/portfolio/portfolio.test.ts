import fetch from 'node-fetch'
import { JsonRpcProvider } from 'ethers'
import { Portfolio } from './portfolio'
import { TokenResult } from './interfaces'
import { describe, expect, test } from '@jest/globals'

describe('Portfolio', () => {
	//const url = 'http://localhost:8545'
	const url = 'https://mainnet.infura.io/v3/d4319c39c4df452286d8bf6d10de28ae'
	const provider = new JsonRpcProvider(url)
	const portfolio = new Portfolio(fetch)

	test('batching works', async () => {
		const [resultOne, resultTwo] = await Promise.all([
			portfolio.update(provider, 'ethereum', '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'),
			portfolio.update(provider, 'ethereum', '0x8F493C12c4F5FF5Fd510549E1e28EA3dD101E850')
		])

		expect(Math.abs(resultOne.discoveryTime - resultTwo.discoveryTime)).toBeLessThanOrEqual(5)
		expect(Math.abs(resultOne.oracleCallTime - resultTwo.oracleCallTime)).toBeLessThanOrEqual(5)
		expect(Math.abs(resultOne.priceUpdateTime - resultTwo.priceUpdateTime)).toBeLessThanOrEqual(5)

		console.dir(resultOne, { depth: null })
		console.dir(resultTwo, { depth: null })
	})
})
