import fetch from 'node-fetch'
import { JsonRpcProvider } from 'ethers'
import { Portfolio } from './portfolio'
import { TokenResult } from './interfaces'
import { describe, expect, test } from '@jest/globals'
import { networks } from '../../consts/networks'

describe('Portfolio', () => {
	const ethereum = networks.find(x => x.id === 'ethereum')
	if (!ethereum) throw new Error('unable to find ethereum network in consts')
	const provider = new JsonRpcProvider(ethereum.rpcUrl)
	const portfolio = new Portfolio(fetch, provider, ethereum)

	test('batching works', async () => {
		const [resultOne, resultTwo, resultThree] = await Promise.all([
			portfolio.update('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'),
			portfolio.update('0x8F493C12c4F5FF5Fd510549E1e28EA3dD101E850'),
			portfolio.update('0x62d00bf1f291be434AC01b3Dc75fA84Af963370A')
		])

		expect(Math.abs(resultOne.discoveryTime - resultTwo.discoveryTime)).toBeLessThanOrEqual(5000)
		expect(Math.abs(resultOne.oracleCallTime - resultTwo.oracleCallTime)).toBeLessThanOrEqual(5000)
		expect(Math.abs(resultOne.priceUpdateTime - resultTwo.priceUpdateTime)).toBeLessThanOrEqual(5000)

		expect(Math.abs(resultOne.discoveryTime - resultThree.discoveryTime)).toBeLessThanOrEqual(5000)
		expect(Math.abs(resultOne.oracleCallTime - resultThree.oracleCallTime)).toBeLessThanOrEqual(5000)
		expect(Math.abs(resultOne.priceUpdateTime - resultThree.priceUpdateTime)).toBeLessThanOrEqual(5000)
	})

	test('simulation', async () => {
		const accountOp = {
			accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
			signingKeyAddr: '0xe5a4Dad2Ea987215460379Ab285DF87136E83BEA',
			gasLimit: null,
			gasFeePayment: null,
			network: { chainId: 0, name: 'ethereum' },
			nonce: 6,
			signature: '0x000000000000000000000000e5a4Dad2Ea987215460379Ab285DF87136E83BEA03',
			calls: [{ to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', value: BigInt(0), data: '0xa9059cbb000000000000000000000000e5a4dad2ea987215460379ab285df87136e83bea00000000000000000000000000000000000000000000000000000000005040aa' }]
		}
		const account = {
			addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
			label: '',
			pfp: '',
			associatedKeys: [],
			factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
			bytecode: '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
			salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
		}
		const postSimulation = await portfolio
			.update('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8', { simulation: { accountOps: [accountOp], account } })
		const entry = postSimulation.tokens.find(x => x.symbol === 'USDC')
		expect(entry.amount - entry.amountPostSimulation).toBe(5259434n)
	})

	test('price cache works', async () => {
		const { priceCache } = await portfolio.update('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')
		const resultTwo = await portfolio.update('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8', { priceCache, priceRecency: 60000 })
		expect(resultTwo.priceUpdateTime).toBeLessThanOrEqual(3)
		expect(resultTwo.tokens.every(x => x.priceIn.length)).toBe(true)
	})
})
