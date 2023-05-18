import { describe, expect, test } from '@jest/globals'
import batcher, { QueueElement, Request } from './batcher'
import { fetch as fetchMock } from './tests/FetchMock'
import fetch from 'node-fetch'
import { networks } from '../../consts/networks'

describe('Batcher tests', () => {
    const batchedVelcroDiscovery = batcher(fetch, queue => {
        const baseCurrencies = [ ...new Set(queue.map(x => x.data.baseCurrency)) ]
        return baseCurrencies.map(baseCurrency => {
            const queueSegment = queue.filter(x => x.data.baseCurrency === baseCurrency)
            const url = `https://relayer.ambire.com/velcro-v3/multi-hints?networks=${queueSegment.map(x => x.data.networkId).join(',')}&accounts=${queueSegment.map(x => x.data.accountAddr).join(',')}&baseCurrency=${baseCurrency}`            
            return { queueSegment, url }
        })
    })
    const ethereum: any = networks.find(x => x.id === 'ethereum')

    test('should initialize a batcher request successfully with a responseIdentifier', async () => {
        const init = batcher(fetchMock, queue => {
            return [{ queueSegment: queue, url: 'example' }]
        })
        const execute = await init({
            number: 333,
            responseIdentifier: 'example'
        })
        expect(execute).toBe('test_success')
    })

    test('should initialize a batcher request without a responseIdentifier an throw an error', async () => {
        expect.assertions(2)
        const init = batcher(fetchMock, queue => {
            return [{ queueSegment: queue, url: 'example' }]
        })
        try {
            const execute = await init({
                number: 333
            })
        } catch (e: any) {
            expect(e).toHaveProperty('example')
            expect(e.example).toBe('test_success')
        }
    })

    test('should do a normal batch requet to velcro and return the hints successfully', async () => {
        const hints = await batchedVelcroDiscovery({
            networkId: ethereum.id,
            accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
            baseCurrency: 'usd'
        })
        expect(hints).toHaveProperty('networkId')
        expect(hints).toHaveProperty('accountAddr')
        expect(hints).toHaveProperty('erc20s')
        expect(hints).toHaveProperty('erc721s')
        expect(hints).toHaveProperty('prices')
    })

    test('should forget to provide a baseCurrency and still successfully execute', async () => {
        const hints = await batchedVelcroDiscovery({
            networkId: ethereum.id,
            accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
        })
        expect(hints).toHaveProperty('networkId')
        expect(hints).toHaveProperty('accountAddr')
        expect(hints).toHaveProperty('erc20s')
        expect(hints).toHaveProperty('erc721s')
        expect(hints).toHaveProperty('prices')
    })

    test('should forget to provide an account address and return an error of invalid address', async () => {
        expect.assertions(1)
        try {
            const hints = await batchedVelcroDiscovery({
                networkId: ethereum.id
            })
        } catch (e: any) {
            expect(e.message).toBe('invalid address')
        }
    })

    test('should forget to provide a network and return an internal error', async () => {
        expect.assertions(1)
        try {
            const hints = await batchedVelcroDiscovery({
                accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
            })
        } catch (e: any) {
            expect(e.message).toBe('internal error')
        }
    })
})