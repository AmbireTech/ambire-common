import { describe, expect, test } from '@jest/globals'
import { geckoRequestBatcher, geckoResponseIdentifier } from './gecko'
import { QueueElement } from './batcher'
import fetch from 'node-fetch'

let queue: QueueElement[] = []
interface QueueElementOption {
    symbol: string,
    address: string,
    amount?: bigint,
    decimals?: number[],
    networkId?: string,
    baseCurrency?: string,
    responseIdentifier?: string,
}
function generateQueueElement(opt: QueueElementOption): void {
    const defaults = {
        amount: 1n,
        decimals: [18],
        networkId: 'ethereum',
        baseCurrency: 'usd',
        responseIdentifier: null
    }
    const el = {...defaults, ...opt}
    new Promise((resolve, reject) => queue.push({ resolve, reject, fetch, data: el }))
}

describe('Gecko tests', () => {
    beforeEach(() => queue = [])

	test('should group the requets by baseCurrency (same chain): 1 request with 3 segments for usd tokens; 1 request for native with usd; 1 request with 1 segment for eur tokens', async () => {
        generateQueueElement({
            symbol: 'USDC',
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            decimals: [6],
        })
        generateQueueElement({
            symbol: 'ETH',
            address: '0x0000000000000000000000000000000000000000',
            responseIdentifier: geckoResponseIdentifier('0x0000000000000000000000000000000000000000', 'ethereum')
        })
        generateQueueElement({
            symbol: 'BAL',
            address: '0xba100000625a3754423978a60c9317c58a424e3D',
        })
        generateQueueElement({
            symbol: 'USDT',
            address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
            decimals: [6],
        })
        // add a euro element
        generateQueueElement({
            symbol: 'USDC',
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            decimals: [6],
            baseCurrency: 'eur'
        })

		const result = geckoRequestBatcher(queue)
        expect(result.length).toBe(3)
        expect(result[0].queueSegment.length).toBe(3)
        const contractAddresses = result[0].url.substring(
            result[0].url.indexOf('contract_addresses=') + "contract_addresses=".length,
            result[0].url.indexOf('&vs_currencies=')
        ).split('%2C')
        expect(contractAddresses.length).toBe(3)
        const baseCurrency = result[0].url.substring(result[0].url.indexOf('vs_currencies=') + "vs_currencies=".length)
        expect(baseCurrency).toBe('usd')

        // second result
        expect(result[1].queueSegment.length).toBe(1)
        expect(result[1].url.indexOf('contract_addresses=')).toBe(-1)
        const baseCurrency2 = result[1].url.substring(result[1].url.indexOf('vs_currencies=') + "vs_currencies=".length)
        expect(baseCurrency2).toBe('usd')

        // eur result
        expect(result[2].queueSegment.length).toBe(1)
        const contractAddressesEuro = result[2].url.substring(
            result[2].url.indexOf('contract_addresses=') + "contract_addresses=".length,
            result[2].url.indexOf('&vs_currencies=')
        )
        expect(contractAddressesEuro.length).toBe(42)
        const baseCurrencyThree = result[2].url.substring(result[2].url.indexOf('vs_currencies=') + "vs_currencies=".length)
        expect(baseCurrencyThree).toBe('eur')
	})

    test('should not group the requets by baseCurrency if they are on different chains', async () => {
        expect.assertions(7)

        generateQueueElement({
            symbol: 'USDC',
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            decimals: [6],
        })
        generateQueueElement({
            symbol: 'USDT',
            address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
            decimals: [6],
            networkId: 'polygon'
        })

		const result = geckoRequestBatcher(queue)
        expect(result.length).toBe(2)

        result.map((el) => {
            expect(el.queueSegment.length).toBe(1)
            let usdcAddr = el.url.substring(
                el.url.indexOf('contract_addresses=') + "contract_addresses=".length,
                el.url.indexOf('&vs_currencies=')
            )
            expect(usdcAddr.length).toBe(42)
            let baseCurr = el.url.substring(el.url.indexOf('vs_currencies=') + "vs_currencies=".length)
            expect(baseCurr).toBe('usd')
        })
	})

    test('should remove duplicates - token version', async () => {
        generateQueueElement({
            symbol: 'USDC',
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            decimals: [6],
        })
        generateQueueElement({
            symbol: 'USDC',
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            decimals: [6],
        })

		const result = geckoRequestBatcher(queue)
        expect(result.length).toBe(1)
        expect(result[0].queueSegment.length).toBe(2)
        const contractAddress = result[0].url.substring(
            result[0].url.indexOf('contract_addresses=') + "contract_addresses=".length,
            result[0].url.indexOf('&vs_currencies=')
        )
        expect(contractAddress.length).toBe(42)
	})

    test('should remove duplicates - native version', async () => {
        generateQueueElement({
            symbol: 'ETH',
            address: '0x0000000000000000000000000000000000000000',
            responseIdentifier: geckoResponseIdentifier('0x0000000000000000000000000000000000000000', 'ethereum')
        })
        generateQueueElement({
            symbol: 'ETH',
            address: '0x0000000000000000000000000000000000000000',
            responseIdentifier: geckoResponseIdentifier('0x0000000000000000000000000000000000000000', 'ethereum')
        })

		const result = geckoRequestBatcher(queue)
        expect(result.length).toBe(1)
        expect(result[0].queueSegment.length).toBe(2)
        const contractAddress = result[0].url.substring(
            result[0].url.indexOf('ids=') + "ids=".length,
            result[0].url.indexOf('&vs_currencies=')
        )
        expect(contractAddress).toBe('ethereum')
	})

    // to do: test not passing a token address or another property - it should probably throw an error?
})