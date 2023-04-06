import { Deployless, DeploylessMode } from './deployless'
import { describe, expect, test } from '@jest/globals'
import { JsonRpcProvider, getDefaultProvider } from '@ethersproject/providers'

const helloWorld = {
	abi: [{"inputs":[],"name":"helloWorld","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"}],
	bin: '0x608060405234801561001057600080fd5b50610173806100206000396000f3fe608060405234801561001057600080fd5b506004361061002b5760003560e01c8063c605f76c14610030575b600080fd5b61003861004e565b604051610045919061011b565b60405180910390f35b60606040518060400160405280600b81526020017f68656c6c6f20776f726c64000000000000000000000000000000000000000000815250905090565b600081519050919050565b600082825260208201905092915050565b60005b838110156100c55780820151818401526020810190506100aa565b60008484015250505050565b6000601f19601f8301169050919050565b60006100ed8261008b565b6100f78185610096565b93506101078185602086016100a7565b610110816100d1565b840191505092915050565b6000602082019050818103600083015261013581846100e2565b90509291505056fea264697066735822122077b66d0a3ada4c8d652f3595b556ed1843dd4a3e3d51d9b16b767577f90d8b8d64736f6c63430008110033',
	binRuntime: '0x608060405234801561001057600080fd5b506004361061002b5760003560e01c8063c605f76c14610030575b600080fd5b61003861004e565b604051610045919061011b565b60405180910390f35b60606040518060400160405280600b81526020017f68656c6c6f20776f726c64000000000000000000000000000000000000000000815250905090565b600081519050919050565b600082825260208201905092915050565b60005b838110156100c55780820151818401526020810190506100aa565b60008484015250505050565b6000601f19601f8301169050919050565b60006100ed8261008b565b6100f78185610096565b93506101078185602086016100a7565b610110816100d1565b840191505092915050565b6000602082019050818103600083015261013581846100e2565b90509291505056fea264697066735822122077b66d0a3ada4c8d652f3595b556ed1843dd4a3e3d51d9b16b767577f90d8b8d64736f6c63430008110033'
}
const deployErrBin = '0x6080604052348015600f57600080fd5b600080fdfe'

describe('Deployless', () => {
	let deployless: Deployless
	test('construct an object', () => {
		const provider = new JsonRpcProvider('https://mainnet.infura.io/v3/84842078b09946638c03157f83405213')
		deployless = new Deployless(provider, helloWorld.abi, helloWorld.bin)
		expect(deployless.isLimitedAt24kbData).toBe(true)
	})

	test('invoke a method: proxy mode', async () => {
		const result = await deployless.call('helloWorld', [], { mode: DeploylessMode.ProxyContract })
		expect(result).toBe('hello world')
		// We still haven't detected support for state override
		expect(deployless.isLimitedAt24kbData).toBe(true)
	})

	test('invoke a method: detect mode', async () => {
		const result = await deployless.call('helloWorld', [])
		expect(result).toBe('hello world')
		// We detected support for state override
		expect(deployless.isLimitedAt24kbData).toBe(false)
	})

	test('detection should not be available with BaseProvider', async () => {
		const provider = getDefaultProvider('homestead')
		expect.assertions(1)
		const deployless = new Deployless(provider, helloWorld.abi, helloWorld.bin)
		try { await deployless.call('helloWorld', []) } catch (e) {
			expect(e.message).toBe('state override mode (or auto-detect) not available unless you use JsonRpcProvider')
		}
	})

	test('deploy error: proxy mode', async () => {
		const provider = new JsonRpcProvider('https://mainnet.infura.io/v3/84842078b09946638c03157f83405213')
		const deployless = new Deployless(provider, helloWorld.abi, deployErrBin)
		expect.assertions(1)
		try { await deployless.call('helloWorld', [], { mode: DeploylessMode.ProxyContract }) } catch (e) {
			expect(e.message).toBe('contract deploy failed')
		}
	})

	test('deploy error: state override mode', async () => {
		const provider = new JsonRpcProvider('https://mainnet.infura.io/v3/84842078b09946638c03157f83405213')
		const deployless = new Deployless(provider, helloWorld.abi, deployErrBin)
		expect.assertions(2)
		try { await deployless.call('helloWorld', []) } catch (e) {
			expect(e.message).toBe('contract deploy failed')
			expect(deployless.isLimitedAt24kbData).toBe(false)
		}
	})

	test('deploy error: state override without detection', async () => {
		const provider = new JsonRpcProvider('https://mainnet.infura.io/v3/84842078b09946638c03157f83405213')
		const deployless = new Deployless(provider, helloWorld.abi, helloWorld.bin, helloWorld.binRuntime)
		// we should already be aware that we are not limited by the 24kb limit
		expect(deployless.isLimitedAt24kbData).toBe(false)
		const result = await deployless.call('helloWorld', [], { mode: DeploylessMode.StateOverride })
		expect(result).toBe('hello world')
		const result2 = await deployless.call('helloWorld', [])
		expect(result2).toBe('hello world')
	})

	test('custom block tag', async () => {
		const provider = new JsonRpcProvider('https://mainnet.infura.io/v3/84842078b09946638c03157f83405213')
		const deployless = new Deployless(provider, helloWorld.abi, helloWorld.bin, helloWorld.binRuntime)
		expect.assertions(2)
		try { await deployless.call('helloWorld', [], { blockTag: '0x1' }) } catch (e) {
			// we are relying on the fact that we do not have the SHR opcode in block 0x1
			expect(e.body.includes('invalid opcode: SHR')).toBe(true)
		}
		try { await deployless.call('helloWorld', [], { blockTag: '0x1', mode: DeploylessMode.ProxyContract }) } catch (e) {
			e = e.error || e
			expect(e.body.includes('invalid opcode: SHR') || e.body.includes('out of gas')).toBe(true)
		}
	})
	// @TODO: error/panic parsing
})
