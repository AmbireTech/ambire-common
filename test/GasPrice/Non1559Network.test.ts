import { expect} from "../config"
import { getGasPriceRecommendations } from "../../v2/libs/gasprice/gasprice"
import MockProvider from "./MockProvider"

describe('1559 Network gas price tests', function() {
  it('should return 0n for gasPrice on an empty block', async function(){
    const params = {
      baseFeePerGas: null,
      transactions: []
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)
    const slow: any = gasPrice[0]
    expect(slow.gasPrice).to.equal(0n)
    const medium: any = gasPrice[1]
    expect(medium.gasPrice).to.equal(0n)
    const fast: any = gasPrice[2]
    expect(fast.gasPrice).to.equal(0n)
    const ape: any = gasPrice[3]
    expect(ape.gasPrice).to.equal(0n)
  })
  it('should return the lowest maxPriorityFeePerGas for a block with less than 4 txns', async function(){
    const params = {
      baseFeePerGas: null,
      transactions: [
        { gasPrice: 800n }, // this gets disregarded
        { gasPrice: 500n }, // this gets disregarded
        { gasPrice: 100n },
      ]
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)
    const slow: any = gasPrice[0]
    expect(slow.gasPrice).to.equal(100n)
    const medium: any = gasPrice[1]
    expect(medium.gasPrice).to.equal(100n)
    const fast: any = gasPrice[2]
    expect(fast.gasPrice).to.equal(100n)
    const ape: any = gasPrice[3]
    expect(ape.gasPrice).to.equal(100n)
  })
  it('should remove outliers from a group of 19, making the group 15, and return an average for each speed at a step of 3, meaning 12 of 15 will enter the calculation and the top 3 will get disregarded', async function(){
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
        { gasPrice: 120n }, // disregarded as the step is 3
        { gasPrice: 150n }, // disregarded as the step is 3
        { gasPrice: 150n }, // disregarded as the step is 3
        { gasPrice: 10000n }, // removed as an outlier
        { gasPrice: 20000n }, // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)
    const slow: any = gasPrice[0]
    expect(slow.gasPrice).to.equal(100n)
    const medium: any = gasPrice[1]
    expect(medium.gasPrice).to.equal(110n)
    const fast: any = gasPrice[2]
    expect(fast.gasPrice).to.equal(110n)
    const ape: any = gasPrice[3]
    expect(ape.gasPrice).to.equal(116n)
  })
  it('should remove 0s from gasPrice but should keep 1s because they are not outliers, and should calculate an average of every group of 4, disregarding the 17th element', async function(){
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
        { gasPrice: 85n }, // disregarded as the step is 4
        { gasPrice: 500n }, // removed as an outlier
        { gasPrice: 500n }, // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)
    const slow: any = gasPrice[0]
    expect(slow.gasPrice).to.equal(20n)
    const medium: any = gasPrice[1]
    expect(medium.gasPrice).to.equal(48n)
    const fast: any = gasPrice[2]
    expect(fast.gasPrice).to.equal(55n)
    const ape: any = gasPrice[3]
    expect(ape.gasPrice).to.equal(74n)
  })
})