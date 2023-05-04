// https://eips.ethereum.org/EIPS/eip-1559
import { expect} from "../config"
import { getGasPriceRecommendations } from "../../v2/libs/gasprice/gasprice"
import MockProvider from "./MockProvider"

describe('1559 Network gas price tests', function() {
  it('makes a gas price prediction on an empty block and returns 0n', async function(){
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
  it('makes a gas price prediction on a block with less than 4 transactions', async function(){
    const params = {
      baseFeePerGas: null,
      transactions: [
        { gasPrice: 100n },
        { gasPrice: 100n },
        { gasPrice: 100n },
      ]
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
  it('makes a gas price prediction with gasUsed 30M, base fee should increase by 12.5%', async function(){
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
})