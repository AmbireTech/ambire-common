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
			// @TODO: not real acc data
			factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
			bytecode: '0x7f4b5ea1a3affe0ba187ea09f321734de5ac90f83e42205194bf86816b91e9b7037fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
			salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
		}
		const postSimulation = await portfolio
			.update(provider, 'ethereum', '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8', { simulation: { accountOps: [accountOp], account } })
		const entry = postSimulation.tokens.find(x => x.symbol === 'USDC')
		expect(entry.amount - entry.amountPostSimulation).toBe(5259434n)
	})
})
