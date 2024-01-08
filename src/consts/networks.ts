import { NetworkDescriptor } from '../interfaces/networkDescriptor'
import { ERC_4337_ENTRYPOINT } from './deploy'

const networks: NetworkDescriptor[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    nativeAssetSymbol: 'ETH',
    rpcUrl:
      'https://rpc.ankr.com/eth/5c7b8f0ac82c95161753873289e1a4f39aa69019b905b8032d76909962719be9',
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
    rpcUrl:
      'https://rpc.ankr.com/polygon/5c7b8f0ac82c95161753873289e1a4f39aa69019b905b8032d76909962719be9',
    rpcNoStateOverride: false,
    chainId: 137n,
    explorerUrl: 'https://polygonscan.com',
    erc4337: {
      // TODO: temp disabled (only while testing)
      enabled: false,
      entryPointAddr: ERC_4337_ENTRYPOINT,
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
    rpcUrl:
      'https://rpc.ankr.com/optimism/5c7b8f0ac82c95161753873289e1a4f39aa69019b905b8032d76909962719be9',
    rpcNoStateOverride: false,
    chainId: 10n,
    explorerUrl: 'https://optimistic.etherscan.io',
    erc4337: {
      enabled: false,
      entryPointAddr: ERC_4337_ENTRYPOINT,
      hasPaymaster: false
    },
    unstoppableDomainsChain: 'ERC20',
    feeOptions: {
      is1559: true,
      elasticityMultiplier: 6n,
      baseFeeMaxChangeDenominator: 50n,
      feeIncrease: 2n // %
    },
    reestimateOn: 6000
  },
  {
    id: 'avalanche',
    name: 'Avalanche',
    nativeAssetSymbol: 'AVAX',
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    rpcNoStateOverride: false,
    chainId: 43114n,
    explorerUrl: 'https://snowtrace.io',
    erc4337: {
      enabled: true,
      entryPointAddr: ERC_4337_ENTRYPOINT,
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
      entryPointAddr: ERC_4337_ENTRYPOINT,
      hasPaymaster: true
    },
    unstoppableDomainsChain: 'ERC20',
    feeOptions: {
      is1559: false
    }
  }
]

export { networks }
