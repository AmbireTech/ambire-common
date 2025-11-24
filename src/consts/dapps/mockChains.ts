import { DefiLlamaChain } from '../../interfaces/dapp'

const mockChains: DefiLlamaChain[] = [
  {
    gecko_id: 'bitcoin',
    tvl: 6057889557.024358,
    tokenSymbol: 'BTC',
    cmcId: '1',
    name: 'Bitcoin',
    chainId: null
  },
  {
    gecko_id: 'ethereum',
    tvl: 64293434711.86114,
    tokenSymbol: 'ETH',
    cmcId: '1027',
    name: 'Ethereum',
    chainId: 1
  },
  {
    gecko_id: 'optimism',
    tvl: 267094848.25739494,
    tokenSymbol: 'OP',
    cmcId: '11840',
    name: 'OP Mainnet',
    chainId: 10
  },
  {
    gecko_id: null,
    tvl: 3924139892.2735286,
    tokenSymbol: null,
    cmcId: null,
    name: 'Base',
    chainId: 8453
  }
]

export default mockChains
