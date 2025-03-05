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
    pectra: {
      url: 'https://rpc.pectra-devnet-5.ethpandaops.io',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    odyssey: {
      url: 'https://odyssey.ithaca.xyz',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    ethereum: {
      url: 'https://invictus.ambire.com/ethereum',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
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
      }
    ]
  }
} as any

export default config
