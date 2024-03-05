import { NetworkDescriptor } from '../interfaces/networkDescriptor'

const networks: NetworkDescriptor[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    nativeAssetSymbol: 'ETH',
    rpcUrl: 'https://invictus.ambire.com/ethereum',
    rpcNoStateOverride: false,
    chainId: 1n,
    explorerUrl: 'https://etherscan.io',
    erc4337: null,
    unstoppableDomainsChain: 'ERC20',
    feeOptions: {
      is1559: true
    }
  },
  {
    id: 'polygon',
    name: 'Polygon',
    nativeAssetSymbol: 'MATIC',
    rpcUrl: 'https://invictus.ambire.com/polygon',
    rpcNoStateOverride: false,
    chainId: 137n,
    explorerUrl: 'https://polygonscan.com',
    erc4337: {
      enabled: false,
      hasPaymaster: true
    },
    unstoppableDomainsChain: 'MATIC',
    feeOptions: {
      is1559: false,
      feeIncrease: 10n // %
    }
  },
  {
    id: 'optimism',
    name: 'Optimism',
    nativeAssetSymbol: 'ETH',
    rpcUrl: 'https://invictus.ambire.com/optimism',
    rpcNoStateOverride: false,
    chainId: 10n,
    explorerUrl: 'https://optimistic.etherscan.io',
    erc4337: {
      enabled: true,
      hasPaymaster: true
    },
    unstoppableDomainsChain: 'ERC20',
    feeOptions: {
      is1559: true,
      elasticityMultiplier: 6n,
      baseFeeMaxChangeDenominator: 50n,
      maxPriorityFeePerGasCalc: 'baseFeePercentange'
    },
    reestimateOn: 6000
  },
  {
    id: 'avalanche',
    name: 'Avalanche',
    nativeAssetSymbol: 'AVAX',
    rpcUrl: 'https://invictus.ambire.com/avalanche',
    rpcNoStateOverride: false,
    chainId: 43114n,
    explorerUrl: 'https://snowtrace.io',
    erc4337: {
      enabled: true,
      hasPaymaster: true
    },
    unstoppableDomainsChain: 'ERC20',
    feeOptions: {
      is1559: true,
      minBaseFee: 25000000000n, // 25 gwei
      feeIncrease: 5n // %
    }
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    nativeAssetSymbol: 'ETH',
    rpcUrl: 'https://invictus.ambire.com/arbitrum',
    rpcNoStateOverride: false,
    chainId: 42161n,
    explorerUrl: 'https://arbiscan.io',
    erc4337: {
      enabled: false,
      hasPaymaster: true
    },
    unstoppableDomainsChain: 'ERC20',
    feeOptions: {
      is1559: true,
      minBaseFee: 100000000n // 1 gwei
    },
    reestimateOn: 6000
  },
  {
    id: 'mantle',
    name: 'Mantle',
    nativeAssetSymbol: 'MNT',
    rpcUrl: 'https://rpc.ankr.com/mantle',
    rpcNoStateOverride: false,
    chainId: 5000n,
    explorerUrl: 'https://explorer.mantle.xyz',
    erc4337: {
      enabled: false,
      hasPaymaster: false
    },
    unstoppableDomainsChain: 'ERC20',
    feeOptions: {
      is1559: false
    },
    reestimateOn: 6000
  }
]

export { networks }
