import { describe, expect, test } from '@jest/globals'

import { suppressConsoleBeforeEach } from '../../../../test/helpers/console'
import { networks } from '../../../consts/networks'
import { getGasPriceRecommendations, MIN_GAS_PRICE } from '../gasPrice'
import MockProvider from './MockProvider'

const network = networks.find((n) => n.chainId === 1n)!

describe('1559 Network gas price tests', () => {
  // Mock providers throw errors we can ignore
  suppressConsoleBeforeEach()
  test('should NOT return 0n for gasPrice on an empty block as we have a minimum set', async () => {
    const params = {
      baseFeePerGas: null,
      transactions: []
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice
    const slow: any = gasPrice[0]
    expect(slow.gasPrice).toBe(MIN_GAS_PRICE)
    const medium: any = gasPrice[1]
    expect(medium.gasPrice).toBe(MIN_GAS_PRICE)
    const fast: any = gasPrice[2]
    expect(fast.gasPrice).toBe(MIN_GAS_PRICE)
    const ape: any = gasPrice[3]
    expect(ape.gasPrice).toBe(MIN_GAS_PRICE)
    provider.destroy()
  })
  test('should return the lowest maxPriorityFeePerGas for a block with less than 4 txns', async () => {
    const params = {
      baseFeePerGas: null,
      transactions: [
        { gasPrice: MIN_GAS_PRICE + 800n }, // this gets disregarded
        { gasPrice: MIN_GAS_PRICE + 500n }, // this gets disregarded
        { gasPrice: MIN_GAS_PRICE + 100n }
      ]
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice
    const slow: any = gasPrice[0]
    expect(slow.gasPrice).toBe(MIN_GAS_PRICE + 100n)
    const medium: any = gasPrice[1]
    expect(medium.gasPrice).toBe(MIN_GAS_PRICE + 100n)
    const fast: any = gasPrice[2]
    expect(fast.gasPrice).toBe(MIN_GAS_PRICE + 100n)
    const ape: any = gasPrice[3]
    expect(ape.gasPrice).toBe(MIN_GAS_PRICE + 100n)
    provider.destroy()
  })
  test('should remove outliers from a group of 19, making the group 15, and return an average for each speed at a step of 3 for slow, medium and fast, and an avg of the remaining 6 for ape', async () => {
    const params = {
      baseFeePerGas: null,
      transactions: [
        { gasPrice: MIN_GAS_PRICE + 1n }, // removed as an outlier
        { gasPrice: MIN_GAS_PRICE + 1n }, // removed as an outlier
        { gasPrice: MIN_GAS_PRICE + 100n },
        { gasPrice: MIN_GAS_PRICE + 100n },
        { gasPrice: MIN_GAS_PRICE + 100n },
        { gasPrice: MIN_GAS_PRICE + 110n },
        { gasPrice: MIN_GAS_PRICE + 110n },
        { gasPrice: MIN_GAS_PRICE + 110n },
        { gasPrice: MIN_GAS_PRICE + 110n },
        { gasPrice: MIN_GAS_PRICE + 110n },
        { gasPrice: MIN_GAS_PRICE + 110n },
        { gasPrice: MIN_GAS_PRICE + 110n },
        { gasPrice: MIN_GAS_PRICE + 120n },
        { gasPrice: MIN_GAS_PRICE + 120n },
        { gasPrice: MIN_GAS_PRICE + 120n },
        { gasPrice: MIN_GAS_PRICE + 150n },
        { gasPrice: MIN_GAS_PRICE + 150n },
        { gasPrice: MIN_GAS_PRICE + 10000n }, // removed as an outlier
        { gasPrice: MIN_GAS_PRICE + 20000n } // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice
    const slow: any = gasPrice[0]
    expect(slow.gasPrice).toBe(MIN_GAS_PRICE + 100n)
    const medium: any = gasPrice[1]
    expect(medium.gasPrice).toBe(MIN_GAS_PRICE + 110n)
    const fast: any = gasPrice[2]
    expect(fast.gasPrice).toBe(MIN_GAS_PRICE + 110n)
    const ape: any = gasPrice[3]
    expect(ape.gasPrice).toBe(MIN_GAS_PRICE + 128n)
    provider.destroy()
  })
  test('should remove 0s from gasPrice but should keep 1s because they are not outliers, and should calculate an average of every group of 4 for slow, medium and fast, and an average of the remaining 5 for ape', async () => {
    const params = {
      baseFeePerGas: null,
      transactions: [
        { gasPrice: 0n }, // removed because no 0s are allowed
        { gasPrice: 0n }, // removed because no 0s are allowed
        { gasPrice: 0n }, // removed because no 0s are allowed
        { gasPrice: MIN_GAS_PRICE + 1n },
        { gasPrice: MIN_GAS_PRICE + 1n },
        { gasPrice: MIN_GAS_PRICE + 40n },
        { gasPrice: MIN_GAS_PRICE + 40n },
        { gasPrice: MIN_GAS_PRICE + 45n },
        { gasPrice: MIN_GAS_PRICE + 50n },
        { gasPrice: MIN_GAS_PRICE + 50n },
        { gasPrice: MIN_GAS_PRICE + 50n },
        { gasPrice: MIN_GAS_PRICE + 55n },
        { gasPrice: MIN_GAS_PRICE + 55n },
        { gasPrice: MIN_GAS_PRICE + 55n },
        { gasPrice: MIN_GAS_PRICE + 55n },
        { gasPrice: MIN_GAS_PRICE + 70n },
        { gasPrice: MIN_GAS_PRICE + 70n },
        { gasPrice: MIN_GAS_PRICE + 72n },
        { gasPrice: MIN_GAS_PRICE + 85n },
        { gasPrice: MIN_GAS_PRICE + 85n },
        { gasPrice: MIN_GAS_PRICE + 500n }, // removed as an outlier
        { gasPrice: MIN_GAS_PRICE + 500n } // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice
    const slow: any = gasPrice[0]
    expect(slow.gasPrice).toBe(MIN_GAS_PRICE + 20n)
    const medium: any = gasPrice[1]
    expect(medium.gasPrice).toBe(MIN_GAS_PRICE + 48n)
    const fast: any = gasPrice[2]
    expect(fast.gasPrice).toBe(MIN_GAS_PRICE + 55n)
    const ape: any = gasPrice[3]
    expect(ape.gasPrice).toBe(MIN_GAS_PRICE + 76n)
    provider.destroy()
  })
})
