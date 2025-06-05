/* eslint-disable import/no-extraneous-dependencies */
import '@nomicfoundation/hardhat-chai-matchers'
import '@nomicfoundation/hardhat-ethers'
import '@nomiclabs/hardhat-etherscan'
import 'hardhat-gas-reporter'

import { HardhatUserConfig } from 'hardhat/config'

require('dotenv').config()

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.19',
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 1000
      }
    }
  },
  gasReporter: {
    enabled: true,
    currency: 'USD',
    coinmarketcap: 'c47b3b52-863b-4ffe-8673-955a09a393c2',
    token: 'ETH'
  },
  networks: {
    base: {
      url: 'https://mainnet.base.org',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    optimism: {
      url: 'https://invictus.ambire.com/optimism',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    odyssey: {
      url: 'https://odyssey.ithaca.xyz',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    ethereum: {
      url: 'https://invictus.ambire.com/ethereum',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    sepolia: {
      url: 'https://eth-sepolia.public.blastapi.io',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    binance: {
      url: 'https://invictus.ambire.com/binance-smart-chain',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    gnosis: {
      url: 'https://rpc.gnosischain.com',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    unichain: {
      url: 'https://unichain-rpc.publicnode.com',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    berachain: {
      url: 'https://rpc.berachain-apis.com',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    }
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY,
      optimism: process.env.OPTIMISM_API_KEY,
      odyssey: process.env.ETHERSCAN_API_KEY,
      ethereum: process.env.ETHERSCAN_API_KEY,
      sepolia: process.env.ETHERSCAN_API_KEY,
      binance: process.env.BNB_API_KEY,
      gnosis: process.env.GNOSIS_API_KEY,
      unichain: process.env.BASESCAN_API_KEY,
      berachain: process.env.BERACHAIN_API_KEY
    },
    customChains: [
      {
        network: 'base',
        chainId: 8453,
        urls: {
          apiURL: 'https://api.basescan.org/api',
          browserURL: 'https://api.basescan.org/api'
        }
      },
      {
        network: 'optimism',
        chainId: 10,
        urls: {
          apiURL: 'https://api-optimistic.etherscan.io/api',
          browserURL: 'https://optimistic.etherscan.io/'
        }
      },
      {
        network: 'ethereum',
        chainId: 1,
        urls: {
          apiURL: 'https://api.etherscan.io/api',
          browserURL: 'https://etherscan.io/'
        }
      },
      {
        network: 'odyssey',
        chainId: 911867,
        urls: {
          apiURL: 'https://explorer-odyssey.t.conduit.xyz/api',
          browserURL: 'https://explorer-odyssey.t.conduit.xyz:443'
        }
      },
      {
        network: 'sepolia',
        chainId: 11155111,
        urls: {
          apiURL: 'https://api-sepolia.etherscan.io/api',
          browserURL: 'https://api-sepolia.etherscan.io/'
        }
      },
      {
        network: 'binance',
        chainId: 56,
        urls: {
          apiURL: 'https://api.bscscan.com/api',
          browserURL: 'https://api.bscscan.com/'
        }
      },
      {
        network: 'gnosis',
        chainId: 100,
        urls: {
          apiURL: 'https://api.gnosisscan.io/api',
          browserURL: 'https://api.gnosisscan.io/'
        }
      },
      {
        network: 'unichain',
        chainId: 130,
        urls: {
          apiURL: 'https://unichain.blockscout.com/api',
          browserURL: 'https://unichain.blockscout.com/'
        }
      },
      {
        network: 'berachain',
        chainId: 80094,
        urls: {
          apiURL: 'https://api.berascan.com/api',
          browserURL: 'https://api.berascan.com'
        }
      }
    ]
  }
} as any

export default config
