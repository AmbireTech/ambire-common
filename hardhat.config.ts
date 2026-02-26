/* eslint-disable import/no-extraneous-dependencies */
import '@nomicfoundation/hardhat-chai-matchers'
import '@nomicfoundation/hardhat-ethers'
import '@nomicfoundation/hardhat-verify'
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
  // sourcify: {
  //   enabled: true,
  //   apiUrl: 'https://sourcify-api-monad.blockvision.org/',
  //   browserUrl: 'https://monadvision.com/'
  // },
  networks: {
    base: {
      url: 'https://mainnet.base.org',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    linea: {
      url: 'https://linea-rpc.publicnode.com',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    monad: {
      url: 'https://rpc.monad.xyz',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    baseSepolia: {
      url: 'https://sepolia.base.org',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    opSepolia: {
      url: 'https://sepolia.optimism.io',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    sepolia: {
      url: 'https://eth-sepolia.g.alchemy.com/v2/demo',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    arbSepolia: {
      url: 'https://sepolia-rollup.arbitrum.io/rpc',
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
    },
    arbitrum: {
      url: 'https://invictus.ambire.com/arbitrum',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    berachainBepolia: {
      url: 'https://bepolia.rpc.berachain.com',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    katana: {
      url: 'https://rpc.katana.network',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    world: {
      url: 'https://worldchain.drpc.org',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    celo: {
      url: 'https://forno.celo.org',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    etherlink: {
      url: 'https://rpc.ankr.com/etherlink_mainnet',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    megaeth: {
      url: 'https://mainnet.megaeth.com/rpc',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    },
    citrea: {
      url: 'https://rpc.mainnet.citrea.xyz',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined
    }
  },
  etherscan: {
    // apiKey: {
    //   base: process.env.ETHERSCAN_API_KEY,
    //   optimism: process.env.ETHERSCAN_API_KEY,
    //   odyssey: process.env.ETHERSCAN_API_KEY,
    //   ethereum: process.env.ETHERSCAN_API_KEY,
    //   sepolia: process.env.ETHERSCAN_API_KEY,
    //   binance: process.env.BNB_API_KEY,
    //   gnosis: process.env.GNOSIS_API_KEY,
    //   unichain: process.env.BASESCAN_API_KEY,
    //   berachain: process.env.BERACHAIN_API_KEY,
    //   arbitrum: process.env.ARBITRUM_API_KEY,
    //   berachainBepolia: process.env.ETHERSCAN_API_KEY,
    //   katana: process.env.ETHERSCAN_API_KEY,
    //   celo: process.env.MULTICHAIN_KEY
    // },
    apiKey: process.env.MULTICHAIN_KEY,
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
        network: 'linea',
        chainId: 59144,
        urls: {
          apiURL: 'https://api.lineascan.build/api',
          browserURL: 'https://lineascan.build'
        }
      },
      {
        network: 'etherlink',
        chainId: 42793,
        urls: {
          apiURL: 'https://explorer.etherlink.com/api',
          browserURL: 'https://explorer.etherlink.com/api'
        }
      },
      {
        network: 'baseSepolia',
        chainId: 84532,
        urls: {
          apiURL: 'https://api.sepolia.basescan.org/api',
          browserURL: 'https://api.sepolia.basescan.org/api'
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
        network: 'arbSepolia',
        chainId: 421614,
        urls: {
          apiURL: 'https://api.sepolia.arbiscan.io/api',
          browserURL: 'https://api.sepolia.arbiscan.io'
        }
      },
      {
        network: 'opSepolia',
        chainId: 11155420,
        urls: {
          apiURL: 'https://api-sepolia-optimistic.etherscan.io/api',
          browserURL: 'https://api-sepolia-optimistic.etherscan.io/api'
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
      },
      {
        network: 'arbitrum',
        chainId: 42161,
        urls: {
          apiURL: 'https://api.arbiscan.io/api',
          browserURL: 'https://api.arbiscan.io'
        }
      },
      {
        network: 'berachainBepolia',
        chainId: 80069,
        urls: {
          // these aren't correct, it's a testnet afterall
          apiURL: 'https://api.testnet.berascan.com/api',
          browserURL: 'https://api.testnet.berascan.com'
        }
      },
      {
        network: 'katana',
        chainId: 747474,
        urls: {
          apiURL: 'https://explorer.katanarpc.com/api',
          browserURL: 'https://explorer.katanarpc.com'
        }
      },
      {
        network: 'celo',
        chainId: 42220,
        urls: {
          apiURL: 'https://api.celoscan.io/api',
          browserURL: 'https://celoscan.io'
        }
      },
      {
        network: 'monad',
        chainId: 143,
        urls: {
          apiURL: 'https://api.monadvision.com',
          browserURL: 'https://monadvision.com'
        }
      },
      {
        network: 'world',
        chainId: 480,
        urls: {
          apiURL: 'https://api.worldscan.org/',
          browserURL: 'https://worldscan.org/'
        }
      },
      {
        network: 'megaeth',
        chainId: 4326,
        urls: {
          apiURL: 'https://api.mega.etherscan.io/',
          browserURL: 'https://mega.etherscan.io/'
        }
      },
      {
        network: 'citrea',
        chainId: 4114,
        urls: {
          apiURL: 'https://explorer.mainnet.citrea.xyz/api',
          browserURL: 'https://explorer.mainnet.citrea.xyz'
        }
      }
    ]
  }
} as any

export default config
