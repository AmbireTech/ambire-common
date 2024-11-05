import { describe, expect, test } from '@jest/globals'

import { networks } from '../../../consts/networks'
import { getGasPriceRecommendations } from '../gasPrice'
import MockProvider from './MockProvider'

const network = networks.find((net) => net.id === 'ethereum')!

describe('1559 Network gas price tests', () => {
  test('should NOT return 0n for gasPrice on an empty block as we have a provider back up', async () => {
    const params = {
      baseFeePerGas: null,
      transactions: []
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice
    const slow: any = gasPrice[0]
    expect(slow.gasPrice).toBe(100n)
    const medium: any = gasPrice[1]
    expect(medium.gasPrice).toBe(105n)
    const fast: any = gasPrice[2]
    expect(fast.gasPrice).toBe(110n)
    const ape: any = gasPrice[3]
    expect(ape.gasPrice).toBe(120n)
  })
  test('should return the lowest maxPriorityFeePerGas for a block with less than 4 txns', async () => {
    const params = {
      baseFeePerGas: null,
      transactions: [
        { gasPrice: 800n }, // this gets disregarded
        { gasPrice: 500n }, // this gets disregarded
        { gasPrice: 100n }
      ]
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice
    const slow: any = gasPrice[0]
    expect(slow.gasPrice).toBe(100n)
    const medium: any = gasPrice[1]
    expect(medium.gasPrice).toBe(100n)
    const fast: any = gasPrice[2]
    expect(fast.gasPrice).toBe(100n)
    const ape: any = gasPrice[3]
    expect(ape.gasPrice).toBe(100n)
  })
  test('should remove outliers from a group of 19, making the group 15, and return an average for each speed at a step of 3 for slow, medium and fast, and an avg of the remaining 6 for ape', async () => {
    const params = {
      baseFeePerGas: null,
      transactions: [
        { gasPrice: 1n }, // removed as an outlier
        { gasPrice: 1n }, // removed as an outlier
        { gasPrice: 100n },
        { gasPrice: 100n },
        { gasPrice: 100n },
        { gasPrice: 110n },
        { gasPrice: 110n },
        { gasPrice: 110n },
        { gasPrice: 110n },
        { gasPrice: 110n },
        { gasPrice: 110n },
        { gasPrice: 110n },
        { gasPrice: 120n },
        { gasPrice: 120n },
        { gasPrice: 120n },
        { gasPrice: 150n },
        { gasPrice: 150n },
        { gasPrice: 10000n }, // removed as an outlier
        { gasPrice: 20000n } // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice
    const slow: any = gasPrice[0]
    expect(slow.gasPrice).toBe(100n)
    const medium: any = gasPrice[1]
    expect(medium.gasPrice).toBe(110n)
    const fast: any = gasPrice[2]
    expect(fast.gasPrice).toBe(110n)
    const ape: any = gasPrice[3]
    expect(ape.gasPrice).toBe(128n)
  })
  test('should remove 0s from gasPrice but should keep 1s because they are not outliers, and should calculate an average of every group of 4 for slow, medium and fast, and an average of the remaining 5 for ape', async () => {
    const params = {
      baseFeePerGas: null,
      transactions: [
        { gasPrice: 0n }, // removed because no 0s are allowed
        { gasPrice: 0n }, // removed because no 0s are allowed
        { gasPrice: 0n }, // removed because no 0s are allowed
        { gasPrice: 1n },
        { gasPrice: 1n },
        { gasPrice: 40n },
        { gasPrice: 40n },
        { gasPrice: 45n },
        { gasPrice: 50n },
        { gasPrice: 50n },
        { gasPrice: 50n },
        { gasPrice: 55n },
        { gasPrice: 55n },
        { gasPrice: 55n },
        { gasPrice: 55n },
        { gasPrice: 70n },
        { gasPrice: 70n },
        { gasPrice: 72n },
        { gasPrice: 85n },
        { gasPrice: 85n },
        { gasPrice: 500n }, // removed as an outlier
        { gasPrice: 500n } // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice
    const slow: any = gasPrice[0]
    expect(slow.gasPrice).toBe(20n)
    const medium: any = gasPrice[1]
    expect(medium.gasPrice).toBe(48n)
    const fast: any = gasPrice[2]
    expect(fast.gasPrice).toBe(55n)
    const ape: any = gasPrice[3]
    expect(ape.gasPrice).toBe(76n)
  })
})
