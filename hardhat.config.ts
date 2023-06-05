import { HardhatUserConfig } from "hardhat/config"
import "@nomicfoundation/hardhat-ethers"
import "hardhat-gas-reporter"

const config: HardhatUserConfig = {
  defaultNetwork: "localhost",
  solidity: {
    version: "0.8.19",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
    coinmarketcap: 'c47b3b52-863b-4ffe-8673-955a09a393c2',
    token: 'ETH'
  }
}

export default config
