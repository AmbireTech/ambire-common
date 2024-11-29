/* eslint-disable import/no-extraneous-dependencies */
import '@nomicfoundation/hardhat-ethers'
import '@nomicfoundation/hardhat-chai-matchers'
import 'hardhat-gas-reporter'
import '@nomiclabs/hardhat-etherscan'

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
      accounts: [process.env.PRIVATE_KEY]
    }
  },
  etherscan: {
    apiKey: process.env.BASESCAN_API_KEY,
    customChains: [
      {
        network: 'base',
        chainId: 8453,
        urls: {
          apiURL: 'https://api.basescan.org/api',
          browserURL: 'https://api.basescan.org/api'
        }
      }
    ]
  }
} as any

export default config
